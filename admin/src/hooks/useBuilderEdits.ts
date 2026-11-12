import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'

import type { PreviewFrameHandle } from '../components/PreviewFrame'
import { useMessages } from '../messages'
import type { BlockFields } from '../utils/builder/fields'
import { itemsOf, startingFields } from '../utils/builder/fields'
import type { BlockAddress } from '../../../contract/preview'
import type { Gap } from '../utils/builder/geometry'
import { gapMessage, GAP_OPEN_HEIGHT, patchMessage } from '../utils/builder/messages'
import {
  duplicate,
  insertAt,
  moveBy,
  moveTo,
  newKey,
  removeKey,
  setFields,
  type BuilderBlock,
} from '../utils/builder/model'
import { nameOf, pushRecent, type CatalogueEntry } from '../utils/builder/palette'
import type { BuilderState } from './useBuilderDocument'
import type { BuilderCatalogue } from './useBuilderCatalogue'

/** The key under which the browser keeps the blocks the editor inserted last. */
export const RECENT_KEY = 'micelio.builder.recent'

/** How long a toast stays, in milliseconds. */
const TOAST_MS = 8000

/** The selection: a block by its key, and an item of it by the field that holds it. */
export interface Selection {
  key: string
  item: { field: string; index: number } | undefined
}

/** What is being dragged: a block of the palette (by catalogue id) or one of the page (by key). */
type Drag = { kind: 'new'; id: string; name: string } | { kind: 'move'; key: string }

/** What the edits need from the page. */
interface EditContext {
  state: Pick<BuilderState, 'blocks' | 'edit' | 'undo'>
  /** The blocks the page's template fixed, by key: they cannot be removed or moved. */
  lockedKeys?: ReadonlySet<string>
  catalogue: BuilderCatalogue | undefined
  language: string
  selection: Selection | undefined
  select: (next: Selection | undefined, isFromFrame?: boolean) => void
  selectedBlock: BuilderBlock | undefined
  fieldsFor: (block: BuilderBlock) => BlockFields
  addressOf: (key: string) => BlockAddress | undefined
  renderedAt: (version: string) => Pick<BuilderBlock, 'key' | 'component'>[]
  reportVersion: string | undefined
  frameVersion: string | undefined
  frame: RefObject<PreviewFrameHandle>
  recent: string[]
  setRecent: Dispatch<SetStateAction<string[]>>
}

/** What the page gets from {@link useBuilderEdits}. */
export interface BuilderEdits {
  drag: Drag | undefined
  setDrag: (drag: Drag | undefined) => void
  /** The gap under the pointer while a block is dragged over the page. */
  target: Gap | undefined
  /** The gap under the pointer while a block is dragged over the list. */
  listGap: number | undefined
  setListGap: (position: number | undefined) => void
  toast: { text: string; id: number } | undefined
  insertEntry: (entry: CatalogueEntry, position: number) => void
  afterSelection: () => number
  positionOfGap: (gap: Gap) => number
  dropAtPosition: (position: number) => void
  endDrag: () => void
  onTarget: (gap: Gap | undefined) => void
  move: (step: -1 | 1) => void
  copy: () => void
  remove: () => void
  /** `isStep` false for a change that is not a step of the page (a file's alternative text). */
  setValues: (values: Record<string, unknown>, isStep?: boolean) => void
  setItem: (field: string, index: number, values: Record<string, unknown>, isStep?: boolean) => void
  addItem: (field: string) => void
  goBack: () => void
  /** Puts the selected block's options back to their defaults; `false` when there is nothing to reset. */
  resetOptions: () => boolean
  /**
   * Sets text fields of a block by its key, selected or not, as one step Undo takes back, and says
   * so in the toast: what a run of a Playground block fills.
   */
  fill: (key: string, values: Record<string, string>, toast: string) => void
}

/**
 * The changes an editor makes to the page (issue #49): insert, move, duplicate, remove, type, drag
 * and undo, with the toast that says what happened (the keyboard is `useBuilderShortcuts`).
 *
 * @remarks
 * Each change goes through `edit` of the document hook, which saves it; text is also sent to the
 * frame as a patch so it shows before the save.
 */
export function useBuilderEdits(ctx: EditContext): BuilderEdits {
  const { t } = useMessages()
  const { state, catalogue, language, selection, select, selectedBlock } = ctx
  const { fieldsFor, addressOf, renderedAt, frame, recent, setRecent } = ctx
  const isLocked = (key: string | undefined) =>
    key !== undefined && ctx.lockedKeys?.has(key) === true
  const { blocks, edit } = state
  const selectedKey = selection?.key
  const frameVersion = ctx.frameVersion
  const [drag, setDrag] = useState<Drag>()
  const [target, setTarget] = useState<Gap>()
  const [listGap, setListGap] = useState<number>()
  const [toast, setToast] = useState<{ text: string; id: number }>()
  const lastText = useRef<{ key: string; field: string; at: number }>()
  const say = (text: string) => setToast({ text, id: Date.now() })

  // Changes of the page.
  const insertEntry = (entry: CatalogueEntry, position: number) => {
    const defaults = Object.fromEntries(
      Object.entries(entry.options).map(([name, option]) => [name, option.default])
    )
    const block: BuilderBlock = {
      key: newKey(),
      component: entry.component,
      fields: startingFields(catalogue?.schemas[entry.component], defaults),
    }
    edit(insertAt(blocks, position, block))
    select({ key: block.key, item: undefined })
    const next = pushRecent(recent, entry.id)
    setRecent(next)
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {
      // Storage that is blocked: the list lives for this visit only.
    }
    say(t('builder.toast.added', { name: nameOf(entry, language) }))
  }
  const afterSelection = () => {
    const at = blocks.findIndex((block) => block.key === selectedKey)
    return at < 0 ? blocks.length : at + 1
  }
  // A gap is a position among the blocks the frame renders; the page's own list may differ until it saves.
  const positionOfGap = (gap: Gap): number => {
    const shown = renderedAt(ctx.reportVersion ?? frameVersion ?? '')
    const before = shown[gap.position]
    const at = before ? blocks.findIndex((block) => block.key === before.key) : -1
    return at < 0 ? blocks.length : at
  }
  const dropAtPosition = (position: number) => {
    if (drag?.kind === 'new') {
      const entry = catalogue?.entries.find(({ id }) => id === drag.id)
      if (entry) insertEntry(entry, position)
    } else if (drag?.kind === 'move' && isLocked(drag.key)) {
      say(t('builder.toast.fixed'))
    } else if (drag?.kind === 'move') {
      const from = blocks.findIndex((block) => block.key === drag.key)
      edit(moveTo(blocks, drag.key, from < position ? position - 1 : position))
      select({ key: drag.key, item: undefined })
      say(t('builder.toast.moved'))
    }
    endDrag()
  }
  const endDrag = () => {
    if (frameVersion) frame.current?.post(gapMessage(frameVersion, null, 0))
    setDrag(undefined)
    setTarget(undefined)
    setListGap(undefined)
  }
  const onTarget = (gap: Gap | undefined) => {
    if (gap?.position === target?.position) return
    setTarget(gap)
    if (frameVersion && gap) {
      frame.current?.post(gapMessage(frameVersion, gap.after, GAP_OPEN_HEIGHT))
    }
  }
  const move = (step: -1 | 1) => {
    if (!selectedKey) return
    if (isLocked(selectedKey)) {
      say(t('builder.toast.fixed'))
      return
    }
    const next = moveBy(blocks, selectedKey, step)
    if (next !== blocks) {
      edit(next)
      say(t('builder.toast.moved'))
    }
  }
  const copy = () => {
    if (!selectedBlock) return
    const clone = duplicate(selectedBlock, catalogue?.schemas ?? {})
    edit(insertAt(blocks, blocks.indexOf(selectedBlock) + 1, clone))
    select({ key: clone.key, item: undefined })
    say(t('builder.toast.duplicated'))
  }
  const remove = () => {
    if (!selectedBlock) return
    if (isLocked(selectedBlock.key)) {
      say(t('builder.toast.fixed'))
      return
    }
    const at = blocks.indexOf(selectedBlock)
    const rest = removeKey(blocks, selectedBlock.key)
    edit(rest)
    const neighbour = rest[Math.min(at, rest.length - 1)]
    select(neighbour ? { key: neighbour.key, item: undefined } : undefined)
    say(t('builder.toast.removed'))
  }
  const setValues = (values: Record<string, unknown>, isStep = true) => {
    if (!selectedBlock) return
    const [field, value] = Object.entries(values)[0] ?? []
    const isText =
      typeof value === 'string' && fieldsFor(selectedBlock).text.some(({ name }) => name === field)
    const last = lastText.current
    const isSame =
      isText &&
      last?.key === selectedBlock.key &&
      last.field === field &&
      Date.now() - last.at < 1500
    lastText.current =
      isText && field ? { key: selectedBlock.key, field, at: Date.now() } : undefined
    edit(setFields(blocks, selectedBlock.key, values), isStep && !isSame)
    // What is not text is a file (an option is a string too, and the panel offers nothing else).
    if (isStep && typeof value !== 'string') say(t('builder.toast.files'))
    const address = isText ? addressOf(selectedBlock.key) : undefined
    if (address && field)
      frame.current?.post(patchMessage(address, { [field]: value as string }, []))
  }
  const setItem = (
    field: string,
    index: number,
    values: Record<string, unknown>,
    isStep = true
  ) => {
    if (!selectedBlock) return
    const list = itemsOf(selectedBlock.fields, field).map((item, at) =>
      at === index ? { ...item, ...values } : item
    )
    // Typing in an item is one step per pause, as typing in a block's field is.
    const [name, value] = Object.entries(values)[0] ?? []
    const spot = `${field}#${index}.${name ?? ''}`
    const last = lastText.current
    const isSame =
      typeof value === 'string' &&
      last?.key === selectedBlock.key &&
      last.field === spot &&
      Date.now() - last.at < 1500
    lastText.current =
      typeof value === 'string'
        ? { key: selectedBlock.key, field: spot, at: Date.now() }
        : undefined
    edit(setFields(blocks, selectedBlock.key, { [field]: list }), isStep && !isSame)
    if (isStep && typeof value !== 'string') say(t('builder.toast.files'))
    const address = addressOf(selectedBlock.key)
    const content = Object.fromEntries(
      Object.entries(values).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
    if (address) frame.current?.post(patchMessage(address, {}, [{ index, content }]))
  }
  const addItem = (field: string) => {
    if (!selectedBlock) return
    const list = [...itemsOf(selectedBlock.fields, field), {}]
    edit(setFields(blocks, selectedBlock.key, { [field]: list }))
    select({ key: selectedBlock.key, item: { field, index: list.length - 1 } })
  }
  const goBack = () => {
    if (state.undo()) setToast(undefined)
  }
  // Every option of the selected block back to the contract's default, as one step.
  const resetOptions = (): boolean => {
    const entry = selectedBlock
      ? catalogue?.entries.find(({ component }) => component === selectedBlock.component)
      : undefined
    if (!selectedBlock || !entry) return false
    const defaults = Object.fromEntries(
      Object.entries(entry.options)
        .filter(([name, option]) => selectedBlock.fields[name] !== option.default)
        .map(([name, option]) => [name, option.default])
    )
    if (Object.keys(defaults).length === 0) return false
    edit(setFields(blocks, selectedBlock.key, defaults))
    say(t('builder.toast.optionsReset'))
    return true
  }

  const fill = (key: string, values: Record<string, string>, toast: string) => {
    lastText.current = undefined
    edit(setFields(blocks, key, values))
    say(toast)
  }

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(undefined), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  return {
    drag,
    setDrag,
    target,
    listGap,
    setListGap,
    toast,
    insertEntry,
    afterSelection,
    positionOfGap,
    dropAtPosition,
    endDrag,
    onTarget,
    move,
    copy,
    remove,
    setValues,
    setItem,
    addItem,
    goBack,
    resetOptions,
    fill,
  }
}
