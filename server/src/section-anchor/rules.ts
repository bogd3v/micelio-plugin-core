import { BLOCKS, type Block } from '../../../contract/blocks'

/** The name of the field a section's anchor is stored in. */
const ANCHOR_FIELD = 'anchor'

/** A kebab-case slug: lowercase letters and digits, joined by single hyphens. */
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** An anchor a save refuses, with where it is. */
export interface AnchorViolation {
  /** Why: not a kebab-case slug, or already used by an earlier block of the page. */
  reason: 'format' | 'duplicate'
  /** The dynamic zone that holds the block. */
  zone: string
  /** The block's position in its zone, from 0. */
  position: number
  /** The `id` of the block in the catalogue. */
  block: string
  /** The anchor as written. */
  anchor: string
  /** For a duplicate, where the anchor was first used. */
  firstUse?: { zone: string; position: number }
}

/**
 * The first anchor of a page that is not a kebab-case slug or that an earlier block already uses.
 *
 * @remarks
 * `null`, an absent field and an empty string are no anchor and are not checked. Only blocks of the
 * catalogue whose `schema` has an `anchor` are looked at. Uniqueness is across every zone the save
 * names, in the order of `zones`, and case-sensitive (a slug has no capitals).
 *
 * @param zones - The dynamic zones of the save by attribute name, each a list of components.
 * @param blocks - The catalogue to check against.
 */
export function findAnchorViolation(
  zones: Readonly<Record<string, readonly unknown[]>>,
  blocks: readonly Block[] = BLOCKS
): AnchorViolation | null {
  const seen = new Map<string, { zone: string; position: number }>()
  for (const [zone, components] of Object.entries(zones)) {
    for (const [position, component] of components.entries()) {
      if (typeof component !== 'object' || component === null) continue
      const content = component as Record<string, unknown>
      const block = blocks.find((candidate) => candidate.schema.component === content.__component)
      if (!block || !(ANCHOR_FIELD in block.schema.fields.shape)) continue
      const anchor = content[ANCHOR_FIELD]
      if (anchor === null || anchor === undefined || anchor === '') continue
      const where = { zone, position, block: block.id }
      if (typeof anchor !== 'string' || !KEBAB_CASE.test(anchor)) {
        return { reason: 'format', ...where, anchor: String(anchor) }
      }
      const first = seen.get(anchor)
      if (first) return { reason: 'duplicate', ...where, anchor, firstUse: first }
      seen.set(anchor, { zone, position })
    }
  }
  return null
}
