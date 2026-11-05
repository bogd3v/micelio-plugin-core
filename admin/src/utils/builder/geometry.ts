import type { BlockAddress, PreviewBox } from '../../../../contract/preview'

/** One block of the frame's last report. */
export interface ReportedBlock {
  address: BlockAddress
  box: PreviewBox
  items: { index: number; box: PreviewBox }[]
}

/** The last `micelio:blocks` of the frame. */
export interface BlocksReport {
  version: string
  scroll: { x: number; y: number }
  viewport: { width: number; height: number }
  blocks: ReportedBlock[]
}

/** A rectangle placed in the overlay, in CSS pixels from its top left corner. */
export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

/** A place where a block may be inserted: after the block at `after`, or at the top for `null`. */
export interface Gap {
  after: number | null
  /** The position the block takes when dropped here. */
  position: number
  /** The line drawn between the two blocks, at the boundary. */
  rect: Rect
}

/** A box of the document as a rectangle of the frame's window: the page's scroll taken off. */
export function toRect(box: PreviewBox, scroll: { x: number; y: number }): Rect {
  return { top: box.y - scroll.y, left: box.x - scroll.x, width: box.width, height: box.height }
}

/** The height of a drawn gap line. */
export const GAP_HEIGHT = 8

/**
 * The places between blocks, from their boxes: one above the first block, one below each.
 *
 * @remarks
 * Only a gap between blocks accepts a drop, never a position inside a block (the Palette states
 * artboard). The line sits on the boundary: the bottom edge of a block, or the top of the page.
 */
export function gapsOf(report: BlocksReport): Gap[] {
  const first = report.blocks[0]
  const lines: Gap[] = []
  const at = (y: number, box: PreviewBox, after: number | null, position: number) =>
    lines.push({
      after,
      position,
      rect: {
        top: y - report.scroll.y - GAP_HEIGHT / 2,
        left: box.x - report.scroll.x,
        width: box.width,
        height: GAP_HEIGHT,
      },
    })
  if (first) at(first.box.y, first.box, null, 0)
  report.blocks.forEach(({ address, box }, position) =>
    at(box.y + box.height, box, address.index, position + 1)
  )
  return lines
}

/** The gap whose line is nearest to a pointer at `y` (in the overlay), or `undefined` when there is none. */
export function nearestGap(gaps: Gap[], y: number): Gap | undefined {
  let best: Gap | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const gap of gaps) {
    const distance = Math.abs(gap.rect.top + gap.rect.height / 2 - y)
    if (distance < bestDistance) {
      best = gap
      bestDistance = distance
    }
  }
  return best
}

/** The block of a report at `index` (`data-myc-index`), if the frame reported one. */
export function reportedAt(
  report: BlocksReport | undefined,
  index: number
): ReportedBlock | undefined {
  return report?.blocks.find(({ address }) => address.index === index)
}
