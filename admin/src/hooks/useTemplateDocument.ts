import { useFetchClient } from '@strapi/strapi/admin'
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  TemplateBlock,
  TemplateContent,
  TemplateEditable,
} from '../../../server/src/types/page-templates'
import { EMPTY_HISTORY, remember, undo, type History } from '../utils/builder/history'
import { newKey, type BuilderBlock } from '../utils/builder/model'
import { ANSWER_REFUSALS, outcomeOf, statusOf } from '../utils/fetchError'

/** What a template's block keeps in the pages made from it, besides its options. */
export interface BlockRule {
  content: TemplateContent
  fixed: boolean
}

/** What the page knows of the template. */
export type TemplateResource =
  | { kind: 'loading' }
  | { kind: 'ready'; template: TemplateEditable }
  | { kind: 'error'; status: number | undefined }

/** Where saving stands: `conflict` when another session saved a version first. */
export type TemplateSaveStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict'

/** What {@link useTemplateDocument} gives the page. The blocks part is what the builder's edits read. */
export interface TemplateDocumentState {
  resource: TemplateResource
  blocks: BuilderBlock[]
  isDirty: boolean
  edit: (next: BuilderBlock[], isUndoable?: boolean) => void
  undo: () => boolean
  canUndo: boolean
  /** What the block called `key` keeps and whether it is fixed. */
  ruleOf: (key: string) => BlockRule
  setRule: (key: string, rule: Partial<BlockRule>) => void
  status: TemplateSaveStatus
  /** Why the last save was refused. */
  detail: string | undefined
  /** Saves the blocks as the next version of the template. */
  save: () => Promise<boolean>
  /** Reads the template again, over what this session changed. */
  reload: () => void
}

const DEFAULT_RULE: BlockRule = { content: 'sample', fixed: false }

/**
 * Reads a template and keeps what the editor does to it: the blocks, what each keeps and whether it
 * is fixed. Unlike a page it is saved on purpose, never on a pause: each save is a new version of the
 * template, with its own line in the history.
 *
 * @param idOf - The catalogue id of a component, for the blocks the editor added.
 */
export function useTemplateDocument(
  id: string,
  idOf: (component: string) => string | undefined
): TemplateDocumentState {
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const idOfRef = useRef(idOf)
  idOfRef.current = idOf
  const [resource, setResource] = useState<TemplateResource>({ kind: 'loading' })
  const [blocks, setBlocks] = useState<BuilderBlock[]>([])
  const [rules, setRules] = useState<Record<string, BlockRule>>({})
  const [history, setHistory] = useState<History>(EMPTY_HISTORY)
  const [status, setStatus] = useState<TemplateSaveStatus>('idle')
  const [detail, setDetail] = useState<string>()
  const [baseline, setBaseline] = useState('')
  const [reloads, setReloads] = useState(0)
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const rulesRef = useRef(rules)
  rulesRef.current = rules

  const snapshot = (list: BuilderBlock[], kept: Record<string, BlockRule>) =>
    JSON.stringify(
      list.map((block) => [block.component, block.fields, kept[block.key] ?? DEFAULT_RULE])
    )

  useEffect(() => {
    let isCurrent = true
    setResource({ kind: 'loading' })
    void (async () => {
      try {
        const answer = await clientRef.current.get<{ data: TemplateEditable }>(
          `/micelio/templates/${encodeURIComponent(id)}`
        )
        if (!isCurrent) return
        const template = answer.data.data
        const loaded: BuilderBlock[] = template.blocks.map((block) => ({
          key: newKey(),
          component: block.component,
          fields: block.data,
        }))
        const kept = Object.fromEntries(
          loaded.map((block, index) => [
            block.key,
            { content: template.blocks[index].content, fixed: template.blocks[index].fixed },
          ])
        )
        setBlocks(loaded)
        setRules(kept)
        setBaseline(snapshot(loaded, kept))
        setHistory(EMPTY_HISTORY)
        setStatus('idle')
        setDetail(undefined)
        setResource({ kind: 'ready', template })
      } catch (error) {
        if (isCurrent) setResource({ kind: 'error', status: statusOf(error) })
      }
    })()
    return () => {
      isCurrent = false
    }
  }, [id, reloads])

  const edit = useCallback((next: BuilderBlock[], isUndoable = true) => {
    if (isUndoable) setHistory((past) => remember(past, blocksRef.current))
    setBlocks(next)
    setStatus((now) => (now === 'saved' || now === 'failed' ? 'idle' : now))
  }, [])

  const goBack = useCallback((): boolean => {
    const step = undo(history)
    if (!step) return false
    setHistory(step.history)
    setBlocks(step.blocks)
    return true
  }, [history])

  const save = useCallback(async (): Promise<boolean> => {
    if (resource.kind !== 'ready') return false
    const sent: Omit<TemplateBlock, 'component'>[] = []
    for (const block of blocksRef.current) {
      const catalogueId = idOfRef.current(block.component)
      // A block the site no longer lists cannot be saved: the server would refuse it by name.
      if (catalogueId === undefined) continue
      const rule = rulesRef.current[block.key] ?? DEFAULT_RULE
      sent.push({
        block: catalogueId,
        content: rule.content,
        fixed: rule.fixed,
        data: block.fields,
      })
    }
    setStatus('saving')
    setDetail(undefined)
    try {
      const outcome = outcomeOf<{ version: number }>(
        await clientRef.current.put(
          `/micelio/templates/${encodeURIComponent(id)}`,
          { expectedVersion: resource.template.version, blocks: sent },
          ANSWER_REFUSALS
        )
      )
      if (!outcome.ok) {
        setDetail(outcome.detail)
        setStatus(outcome.code === 'templateVersionConflict' ? 'conflict' : 'failed')
        return false
      }
      setResource({
        kind: 'ready',
        template: { ...resource.template, version: outcome.data.version },
      })
      setBaseline(snapshot(blocksRef.current, rulesRef.current))
      setStatus('saved')
      return true
    } catch {
      setStatus('failed')
      return false
    }
  }, [id, resource])

  return {
    resource,
    blocks,
    isDirty: resource.kind === 'ready' && snapshot(blocks, rules) !== baseline,
    edit,
    undo: goBack,
    canUndo: history.past.length > 0,
    ruleOf: (key) => rules[key] ?? DEFAULT_RULE,
    setRule: (key, rule) => {
      setRules((now) => ({ ...now, [key]: { ...(now[key] ?? DEFAULT_RULE), ...rule } }))
      setStatus((now) => (now === 'saved' || now === 'failed' ? 'idle' : now))
    },
    status,
    detail,
    save,
    reload: () => setReloads((count) => count + 1),
  }
}
