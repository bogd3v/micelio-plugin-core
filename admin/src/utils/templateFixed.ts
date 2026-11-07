import type { FixedMark } from '../../../server/src/types/page-templates'

/**
 * The keys of the blocks a page's template fixed.
 *
 * @remarks
 * A mark names the `nth` block of a catalogue id among the blocks the page held when it was
 * loaded; the lock goes to the block that carries that row (its component and Strapi `id`), as the
 * server does, so a block added before it, unsaved, takes no lock and the original keeps it. A
 * block with no `id` is new and is never locked.
 *
 * @param blocks - The page's blocks now, in order.
 * @param held - The blocks the page held when it was loaded, in order.
 * @param marks - The marks the page records.
 * @param idOf - The catalogue id of a block, `undefined` for a block the site does not list.
 */
export function lockedKeysOf<T extends { key: string; component: string; id?: number }>(
  blocks: readonly T[],
  held: readonly { component: string; id?: number }[],
  marks: readonly FixedMark[],
  idOf: (block: { component: string }) => string | undefined
): Set<string> {
  const seen = new Map<string, number>()
  const rows = new Set<string>()
  for (const block of held) {
    const id = idOf(block)
    if (id === undefined) continue
    const nth = (seen.get(id) ?? 0) + 1
    seen.set(id, nth)
    if (block.id !== undefined && marks.some((mark) => mark.block === id && mark.nth === nth)) {
      rows.add(`${block.component}:${block.id}`)
    }
  }
  return new Set(
    blocks
      .filter((block) => block.id !== undefined && rows.has(`${block.component}:${block.id}`))
      .map((block) => block.key)
  )
}
