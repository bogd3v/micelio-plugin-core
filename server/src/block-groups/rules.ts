import { BLOCKS, type Block } from '../../../contract/blocks'
import { GROUP_KEY } from '../constants/reusable-blocks'

/** A block of a page, by where it is. */
export interface BlockPlace {
  /** The dynamic zone that holds the block. */
  zone: string
  /** The block's position in its zone, from 0. */
  position: number
  /** The `id` of the block in the catalogue, or the component's UID for a host's own component. */
  block: string
}

/** A group a save refuses (ADR-0022, section 2), with the block it names and the one it clashes with. */
export interface GroupViolation extends BlockPlace {
  /**
   * `split`: the block reopens a group that a block of another group, or of none, closed before it;
   * `tone`: the block's group `tone` is not the one an earlier member set.
   */
  reason: 'split' | 'tone'
  /** The `groupId` of the group. */
  groupId: string
  /** The earlier member: for `split` the last one before the gap, for `tone` the first of the group. */
  member: BlockPlace
  /**
   * For `split`, the first block that sits between `member` and this one; absent when the end of
   * `member`'s zone is what closed the run.
   */
  between?: BlockPlace
  /** For `tone`, the group's `tone` as `member` sets it. */
  groupTone?: unknown
  /** For `tone`, the `tone` this block's group key sets. */
  tone?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The first group of a page that is split into two runs or whose members set two `tone`s.
 *
 * @remarks
 * A block is a member when its `group` key has a `groupId` that is a non-empty string; a key that is
 * absent, `null` or has no `groupId` makes no member. Every block of the zones counts for the
 * contiguity, a host's own component and a block of the catalogue that takes no `group` key
 * included: either one between two members splits the group. A run ends with its zone, so a
 * `groupId` in two zones is two runs. A group of one is valid, and the `tone` option of a member is
 * never read: it is ignored while the block is in the group, not refused.
 *
 * @param zones - The dynamic zones of the save by attribute name, each a list of components.
 * @param blocks - The catalogue, to name a block by its `id`.
 * @returns The violation, or `null` when every group is one run with one `tone`.
 */
export function findGroupViolation(
  zones: Readonly<Record<string, readonly unknown[]>>,
  blocks: readonly Block[] = BLOCKS
): GroupViolation | null {
  const first = new Map<string, { place: BlockPlace; tone: unknown }>()
  const closed = new Map<string, { member: BlockPlace; between?: BlockPlace }>()
  for (const [zone, components] of Object.entries(zones)) {
    let open: { groupId: string; last: BlockPlace } | null = null
    for (const [position, component] of components.entries()) {
      const content = isRecord(component) ? component : {}
      const place = { zone, position, block: nameOf(content, blocks) }
      const key = content[GROUP_KEY]
      const groupId = isRecord(key) && typeof key.groupId === 'string' ? key.groupId : ''
      if (open && open.groupId !== groupId) {
        closed.set(open.groupId, { member: open.last, between: place })
        open = null
      }
      if (groupId === '') continue
      const gap = closed.get(groupId)
      if (gap) return { reason: 'split', ...place, groupId, ...gap }
      const tone = (key as Record<string, unknown>).tone ?? null
      const earlier = first.get(groupId)
      if (earlier && earlier.tone !== tone) {
        return {
          reason: 'tone',
          ...place,
          groupId,
          member: earlier.place,
          groupTone: earlier.tone,
          tone,
        }
      }
      if (!earlier) first.set(groupId, { place, tone })
      open = { groupId, last: place }
    }
    if (open) closed.set(open.groupId, { member: open.last })
  }
  return null
}

// The catalogue `id` of a block, or what the data names it by when it is not one.
function nameOf(content: Record<string, unknown>, blocks: readonly Block[]): string {
  const component = typeof content.__component === 'string' ? content.__component : ''
  return blocks.find((block) => block.schema.component === component)?.id ?? component
}
