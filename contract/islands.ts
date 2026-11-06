// What the catalogue and the admin share about islands (ADR-0018, section 1): the kinds, the weight
// that decides how an island loads, and what counts as a filled-in field of its static alternative.
// It imports nothing, so the admin bundles it without the catalogue.

/** The kinds of island, each with one badge in the admin (the Island badge artboard). */
export const ISLAND_KINDS = ['3d', 'runtime', 'media', 'diagram', 'data'] as const

/** What an island is: a 3D scene, a code runtime, media, a diagram or data. */
export type IslandKind = (typeof ISLAND_KINDS)[number]

/** The weight, in kB, above which an island loads on a click and below which it loads in view. */
export const ON_CLICK_ABOVE_KB = 1024

/** How an island loads: on a click of the visitor, or when it scrolls into view. */
export type IslandTrigger = 'click' | 'view'

/** How an island that loads `loadKb` kB once used is triggered. */
export function triggerOf(loadKb: number): IslandTrigger {
  return loadKb > ON_CLICK_ABOVE_KB ? 'click' : 'view'
}

/** Whether a stored value counts as filled in: text that is not blank, a file, a list with a member. */
export function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}
