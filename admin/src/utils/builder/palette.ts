import type { IslandKind } from '../../../../contract/islands'

/** A block of the site's catalogue as `GET /micelio/blocks?site=` answers it, reduced to what the builder reads. */
export interface CatalogueEntry {
  /** The block's catalogue id, such as `feature-grid`. */
  id: string
  group: 'section' | 'article'
  /** The component that stores it, such as `section.feature-grid`. */
  component: string
  /** The presentation options the block exposes, as the site merges them. */
  options: Record<string, { values: readonly string[]; default: string }>
  /** The site's label of the block by locale; `{}` when it set none. */
  label: Partial<Record<string, string>>
  /** The page types the block may be inserted in. */
  pageTypes: string[]
  cost: {
    css: number
    js: number
    /** The heavy island the block renders; `null` for a block that renders none. */
    island: {
      js: number
      kind: IslandKind
      /** What it loads once used, in kB: above 1024 it loads on a click, below it in view. */
      loadKb: number
      /** The fields of the block its static alternative is made of. */
      alternative: readonly string[]
    } | null
  }
}

/** Why a row of the palette is not a plain one. */
export type RowState = 'ok' | 'notAllowed' | 'overBudget'

/** A row of the palette. */
export interface PaletteRow {
  entry: CatalogueEntry
  name: string
  /** The weight the block adds to a page, in kB, one decimal. */
  costKb: number
  isIsland: boolean
  state: RowState
}

/** A group of rows, in the order the palette lists them. */
export interface PaletteGroup {
  /** `recent`, `results`, `section`, `article` or `overBudget`. */
  id: 'recent' | 'results' | 'section' | 'article' | 'overBudget'
  rows: PaletteRow[]
}

/** The weight a block adds to a page, in kB with one decimal (gzip bytes of CSS and JS; an island's on-demand script is apart). */
export function costKbOf(entry: Pick<CatalogueEntry, 'cost'>): number {
  return Math.round(((entry.cost.css + entry.cost.js) / 1024) * 10) / 10
}

/** The name an editor sees for a block: the site's label in the locale, else the title-cased `id`. */
export function nameOf(entry: Pick<CatalogueEntry, 'id' | 'label'>, locale: string): string {
  const label = entry.label[locale.startsWith('es') ? 'es' : 'en'] ?? entry.label.en
  if (label) return label
  const words = entry.id.replaceAll('-', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The state of a block for a page: not allowed when the site's list for the block leaves the page
 * type out, over the budget when it costs more than what is left on the page.
 *
 * @param leftKb - What the page's budget has left, in kB, or `undefined` while it is not measured.
 */
export function stateOf(
  entry: CatalogueEntry,
  pageType: string,
  leftKb: number | undefined
): RowState {
  if (!entry.pageTypes.includes(pageType)) return 'notAllowed'
  return leftKb !== undefined && costKbOf(entry) > leftKb ? 'overBudget' : 'ok'
}

/** Whether a search matches a row: the name or the `id` contains it, ignoring case. */
export function matches(row: PaletteRow, search: string): boolean {
  const needle = search.trim().toLowerCase()
  return needle === '' || row.name.toLowerCase().includes(needle) || row.entry.id.includes(needle)
}

/** Splits a name around the first match of a search, so the match can be set in bold. */
export function highlight(
  name: string,
  search: string
): { before: string; match: string; after: string } {
  const needle = search.trim().toLowerCase()
  const at = needle === '' ? -1 : name.toLowerCase().indexOf(needle)
  if (at < 0) return { before: name, match: '', after: '' }
  return {
    before: name.slice(0, at),
    match: name.slice(at, at + needle.length),
    after: name.slice(at + needle.length),
  }
}

/**
 * The groups of the palette: with a search, one group of results; without, the recently used
 * blocks and then the catalogue's own groups, "Sections" and "Shared", and last the blocks that
 * cost more than what is left on the page, apart from the rest.
 *
 * @param recent - The `id`s the editor inserted last, newest first.
 */
export function groupRows(rows: PaletteRow[], search: string, recent: string[]): PaletteGroup[] {
  if (search.trim() !== '')
    return [{ id: 'results', rows: rows.filter((row) => matches(row, search)) }]
  const within = rows.filter((row) => row.state !== 'overBudget')
  const used = recent.flatMap((id) => within.filter((row) => row.entry.id === id))
  const groups: PaletteGroup[] = [
    { id: 'recent', rows: used },
    { id: 'section', rows: within.filter((row) => row.entry.group === 'section') },
    { id: 'article', rows: within.filter((row) => row.entry.group === 'article') },
    { id: 'overBudget', rows: rows.filter((row) => row.state === 'overBudget') },
  ]
  return groups.filter((group) => group.rows.length > 0)
}

/** The ids with `id` first, without a repeat, at most `limit` of them. */
export function pushRecent(recent: string[], id: string, limit = 3): string[] {
  return [id, ...recent.filter((other) => other !== id)].slice(0, limit)
}
