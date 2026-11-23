// What a block adds to a page, as one number (ADR-0018, section 1; ADR-0021, section 3). No import,
// so the admin bundle can use it without the catalogue.

/** The parts of a block's `cost` that every page holding it carries, in gzip bytes. */
export interface PageCost {
  /** Its CSS. */
  css: number
  /** Its JS in the page bundle. */
  js: number
  /** The sprite entries its icon fields add; absent for a block without an icon field. */
  icons?: number
}

/**
 * The gzip bytes a block adds to every page that holds it: its CSS, its JS and the sprite entries
 * of its icons. A heavy island's on-demand script is apart (`cost.island`).
 */
export function costBytes(cost: PageCost): number {
  return cost.css + cost.js + (cost.icons ?? 0)
}
