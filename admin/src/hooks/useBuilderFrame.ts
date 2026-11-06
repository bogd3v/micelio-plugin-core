import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { BlockAddress, PreviewMessage } from '../../../contract/preview'
import type { Pointed } from '../components/builder/Overlay'
import type { FrameState, PreviewFrameHandle } from '../components/PreviewFrame'
import type { BlockFields } from '../utils/builder/fields'
import type { BlocksReport } from '../utils/builder/geometry'
import { selectMessage } from '../utils/builder/messages'
import type { BuilderBlock } from '../utils/builder/model'
import type { CatalogueEntry } from '../utils/builder/palette'
import type { BuilderCatalogue } from './useBuilderCatalogue'
import type { BuilderState } from './useBuilderDocument'
import type { Selection } from './useBuilderEdits'

/** How long an answer of the frame to a `micelio:select` is expected, in milliseconds. */
const ANSWER_WAIT_MS = 2000

interface FrameContext {
  state: BuilderState
  catalogue: BuilderCatalogue | undefined
  byComponent: Map<string, CatalogueEntry>
  fieldsFor: (block: BuilderBlock) => BlockFields
  frame: RefObject<PreviewFrameHandle>
  frameState: FrameState
  /** Loads the preview again with a new token, for a frame that cannot be told to load the draft. */
  reload: () => void
}

/** What the page gets from {@link useBuilderFrame}. */
export interface BuilderFrame {
  selection: Selection | undefined
  select: (next: Selection | undefined, isFromFrame?: boolean) => void
  /** The last boxes the frame in view reported. */
  report: BlocksReport | undefined
  /** The block under the pointer in the frame. */
  hovered: Pointed | undefined
  /** The address of a block in the frame in view; `undefined` when the frame has not rendered it. */
  addressOf: (key: string) => BlockAddress | undefined
  /** The blocks of a version the frame renders, in order. */
  renderedAt: (version: string) => Pick<BuilderBlock, 'key' | 'component'>[]
  onFrameMessage: (message: PreviewMessage) => void
}

/**
 * What the builder knows of the frame: the boxes it reported, the block under the pointer, the
 * selection and how it travels both ways (phase 2 of the protocol, ADR-0019).
 *
 * @remarks
 * A block is addressed by its position among those the frame rendered at a version, so each
 * message is mapped through `blocksAt` of that version, never through the page's current list. The
 * frame answers every `micelio:select` with `micelio:selected`; those answers are not clicks and
 * are ignored for a short while after the page asked. The page posts a selection when it changes or
 * the frame reloads, and asks the frame to scroll to it the first time and when it reloads after a
 * save, so the block being edited stays in view.
 */
export function useBuilderFrame(ctx: FrameContext): BuilderFrame {
  const { state, catalogue, byComponent, fieldsFor, frame, frameState, reload } = ctx
  const { blocks } = state
  const [report, setReport] = useState<BlocksReport>()
  const [selection, setSelection] = useState<Selection>()
  const [hovered, setHovered] = useState<Pointed>()
  const reveal = useRef(true)
  // The version the frame showed when the page asked it to load the draft again, until it says
  // `ready` with another: the selected block is then brought back into view.
  const reloadingFrom = useRef<{ version: string | undefined } | undefined>(undefined)
  // When the page asked the frame to select: its `micelio:selected` answers are not clicks.
  const asked = useRef<{ at: number; index: number; item: number | null }[]>([])
  // Every block of the zone counts, the ones the catalogue no longer lists included (a site may
  // disable a block a page keeps): the frame numbers the zone, not the palette.
  const renderedAt = (version: string) => state.blocksAt(version) ?? []
  const addressOf = useCallback(
    (key: string) => {
      const version = frameState.version
      if (!version) return undefined
      const shown = state.blocksAt(version) ?? []
      const index = shown.findIndex((block) => block.key === key)
      const found = shown[index]
      if (!found) return undefined
      const block = byComponent.get(found.component)?.id ?? found.component.replace(/^[^.]*\./, '')
      return { zone: 'sections' as const, index, block, version }
    },

    [frameState.version, byComponent, state.blocksAt]
  )
  const itemsField = (block: BuilderBlock) => fieldsFor(block).items[0]?.name

  const select = useCallback((next: Selection | undefined, isFromFrame = false) => {
    reveal.current = !isFromFrame
    setSelection(next)
  }, [])

  // An answer names the block and item the page asked about; a click on another one is a click.
  const isAnswer = (index: number, item: number | null): boolean => {
    asked.current = asked.current.filter(({ at }) => Date.now() - at < ANSWER_WAIT_MS)
    const at = asked.current.findIndex((ask) => ask.index === index && ask.item === item)
    if (at < 0) return false
    asked.current.splice(at, 1)
    return true
  }

  // Messages of the frame (phase 2): the boxes, a click, the pointer.
  const onFrameMessage = useCallback(
    (message: PreviewMessage) => {
      if (message.type === 'micelio:blocks') {
        setReport(message.payload)
      } else if (message.type === 'micelio:selected' || message.type === 'micelio:hovered') {
        const { address, item } = message.payload
        const key = address ? state.blocksAt(address.version)?.[address.index]?.key : undefined
        const block = key ? blocks.find((candidate) => candidate.key === key) : undefined
        if (message.type === 'micelio:hovered') {
          setHovered(address && key ? { index: address.index, item } : undefined)
        } else if (address && isAnswer(address.index, item)) {
          // The frame answered a `micelio:select` of this page, which may be about an earlier selection.
        } else if (block && key) {
          const field = itemsField(block)
          select({ key, item: item !== null && field ? { field, index: item } : undefined }, true)
        }
      }
    },

    [blocks, state.blocksAt, select, catalogue]
  )

  // Tell the frame what is selected, again after it reloads (the version changes).
  const selectedKey = selection?.key
  const selectedItem = selection?.item?.index ?? null
  useEffect(() => {
    const address = selectedKey ? addressOf(selectedKey) : undefined
    // A block the frame has not rendered yet (not saved) has no address: nothing to outline there.
    if (selectedKey && !address) return
    // The frame reloaded after a save: the block being edited may be out of view, so scroll to it.
    if (reloadingFrom.current && frameState.version !== reloadingFrom.current.version) {
      reloadingFrom.current = undefined
      if (selectedKey) reveal.current = true
    }
    const isSent = frame.current?.post(
      selectMessage(address ?? null, address ? selectedItem : null, reveal.current)
    )
    // The answer to "nothing selected" carries no block, so it is never mistaken for a click.
    if (isSent && address)
      asked.current.push({ at: Date.now(), index: address.index, item: selectedItem })
    // The frame scrolls to the block for the selection that asked for it and after a reload; any
    // other post only outlines, so a block the editor scrolled away from stays where it is.
    if (isSent) reveal.current = false
    // `addressOf` changes only with the frame's version or the catalogue, never with a render.
  }, [selectedKey, selectedItem, addressOf, frameState.version])

  // The state of the page after a save: the frame loads the draft again.
  const handledSaves = useRef(0)
  useEffect(() => {
    if (state.savedCount === 0 || state.savedCount === handledSaves.current) return
    handledSaves.current = state.savedCount
    reloadingFrom.current = { version: frameState.version }
    if (!frame.current?.loadDraft()) reload()
    // `frameState.version` is read only when a save lands.
  }, [state.savedCount, reload])

  return { selection, select, report, hovered, addressOf, renderedAt, onFrameMessage }
}
