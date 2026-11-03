import type { BlockUsage, MergedOption } from '../../../server/src/types/blocks'

/** One row of the Block catalogue page, as `GET /micelio/block-settings` answers it. */
export interface CatalogueBlock {
  /** The `id` of the block in the catalogue. */
  id: string
  group: 'section' | 'article'
  /** The Strapi component that stores the block. */
  component: string
  /** The options the block exposes, with the site's defaults. */
  options: Record<string, MergedOption>
  /** What the block adds to a page, in kB (gzip), as declared in the contract. */
  costKb: number
  isIsland: boolean
  enabled: boolean
  /** The page types the block is allowed in; `null` takes the core's default, every page type. */
  allowedPageTypes: string[] | null
  /** What the site stored, by option name. */
  defaultOptions: Record<string, string>
  labels: Partial<Record<'en' | 'es', string>>
  /** How many pages of the site hold the block. */
  used: number
}

/** What the page shows for a site. */
export interface CatalogueView {
  site: string
  pageTypes: string[]
  blocks: CatalogueBlock[]
}

export type { BlockUsage }

/** The families of the filter: all blocks, or one of the contract's two groups. */
export type Family = 'all' | CatalogueBlock['group']

/** The filters of the page. */
export interface BlockFilters {
  search: string
  family: Family
  islandsOnly: boolean
  disabledOnly: boolean
}

/** The difference, in kB, under which a measurement is said to be within tolerance of the declared cost. */
export const MEASURE_TOLERANCE_KB = 0.5

/** The blocks the filters leave in view, in the catalogue's order. */
export function filterBlocks(blocks: CatalogueBlock[], filters: BlockFilters): CatalogueBlock[] {
  const needle = filters.search.trim().toLowerCase()
  return blocks.filter(
    (block) =>
      (filters.family === 'all' || block.group === filters.family) &&
      (!filters.islandsOnly || block.isIsland) &&
      (!filters.disabledOnly || !block.enabled) &&
      (needle === '' ||
        block.id.includes(needle) ||
        block.component.includes(needle) ||
        Object.values(block.labels).some((label) => label.toLowerCase().includes(needle)))
  )
}

/** How many blocks are disabled and how many enabled. */
export function countEnabled(blocks: CatalogueBlock[]): { disabled: number; enabled: number } {
  const disabled = blocks.filter((block) => !block.enabled).length
  return { disabled, enabled: blocks.length - disabled }
}

/** The name an editor sees for a block: its label in the locale, else the title-cased `id`. */
export function blockName(block: Pick<CatalogueBlock, 'id' | 'labels'>, locale: string): string {
  const label = block.labels[locale.startsWith('es') ? 'es' : 'en'] ?? block.labels.en
  if (label) return label
  const words = block.id.replaceAll('-', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The page types a block is allowed in now: its stored list, else every one. */
export function allowedIn(block: CatalogueBlock, pageTypes: string[]): string[] {
  return block.allowedPageTypes ?? pageTypes
}

/** How a measurement compares with the declared cost: within tolerance, or by how much it is over or under. */
export function compareCost(
  declaredKb: number,
  measuredKb: number
): { kind: 'within' | 'over' | 'under'; differenceKb: number } {
  const differenceKb = Math.round((measuredKb - declaredKb) * 10) / 10
  if (Math.abs(measuredKb - declaredKb) <= MEASURE_TOLERANCE_KB)
    return { kind: 'within', differenceKb }
  return { kind: differenceKb > 0 ? 'over' : 'under', differenceKb: Math.abs(differenceKb) }
}

/** The page to measure a block on: the first page that holds it and is of a type the CMS measures. */
export function pageToMeasure(pages: BlockUsage[]): BlockUsage | undefined {
  return pages.find((page) => page.isMeasured && page.updatedAt !== null)
}

/** Where the Content Manager edits a page. */
export function editPath(page: Pick<BlockUsage, 'uid' | 'documentId' | 'locale'>): string {
  const query = page.locale ? `?plugins[i18n][locale]=${encodeURIComponent(page.locale)}` : ''
  return `/content-manager/collection-types/${page.uid}/${page.documentId}${query}`
}

/** What "Download schema" saves: the JSON Schema of every block, keyed by `id`, as `contract/blocks.schema.json`. */
export function schemaDocument(blocks: { id: string; schema: unknown }[]): string {
  return JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Micelio block catalogue',
      $defs: Object.fromEntries(blocks.map(({ id, schema }) => [id, schema])),
    },
    null,
    2
  )
}

/** The name of a page type: its translation when the plugin has one (`landing`, `standard`, `long-read`), else the key as the site defined it. */
export function pageTypeLabel(
  type: string,
  t: (id: string) => string,
  has: (id: string) => boolean
): string {
  const id = `blocks.pageType.${type}`
  return has(id) ? t(id) : type
}
