import {
  PREVIEW_PROTOCOL_VERSION,
  type BlockAddress,
  type PreviewMessage,
} from '../../../../contract/preview'

/** The `type` and `payload` of a message the builder sends to the frame. */
export type OutgoingMessage = Extract<
  PreviewMessage,
  { type: 'micelio:select' | 'micelio:hover' | 'micelio:insertGap' | 'micelio:patch' }
>

/** The envelope of a message to the frame. */
function envelope<T extends OutgoingMessage['type']>(
  type: T,
  payload: Extract<OutgoingMessage, { type: T }>['payload']
): Extract<OutgoingMessage, { type: T }> {
  return { v: PREVIEW_PROTOCOL_VERSION, type, payload } as Extract<OutgoingMessage, { type: T }>
}

/** Outline a block, or an item of it, or nothing; `reveal` scrolls it into view. */
export const selectMessage = (
  address: BlockAddress | null,
  item: number | null,
  reveal: boolean
): Extract<OutgoingMessage, { type: 'micelio:select' }> =>
  envelope('micelio:select', { address, item, reveal })

/** Open a gap of `height` pixels after the block at `after` (the top for `null`); 0 closes it. */
export const gapMessage = (
  version: string,
  after: number | null,
  height: number
): Extract<OutgoingMessage, { type: 'micelio:insertGap' }> =>
  envelope('micelio:insertGap', { version, zone: 'sections', after, height })

/** New text for a field of a block, or of one of its items, to show before the save. */
export const patchMessage = (
  address: BlockAddress,
  content: Record<string, string | null>,
  items: { index: number; content: Record<string, string | null> }[]
): Extract<OutgoingMessage, { type: 'micelio:patch' }> =>
  envelope('micelio:patch', { address, content, items })

/** The height of the gap that opens while a block is dragged over a place, in pixels. */
export const GAP_OPEN_HEIGHT = 120
