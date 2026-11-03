import type { LABEL_LOCALES } from '../constants/blocks'

/** The label of a block in the palette, by locale; a locale it does not name shows the block's own name. */
export type BlockLabels = Partial<Record<(typeof LABEL_LOCALES)[number], string>>

/** What a site manages of one block (`plugin::micelio.block-setting`), with the defaults of a block nothing was stored for. */
export interface BlockSetting {
  /** The `id` of the block in the catalogue. */
  block: string
  /** Whether an editor of the site may insert the block; a page that already uses it keeps rendering. */
  enabled: boolean
  /** The page types the block may be inserted in; `null` takes the core's default, which is every one. */
  allowedPageTypes: string[] | null
  /** The value a new block starts with, by option name; an option it does not name starts with the block's own default. */
  defaultOptions: Record<string, string>
  labels: BlockLabels
}

/** One option of a block as the merged view answers it. */
export interface MergedOption {
  /** The values the block offers, as in the contract. */
  values: readonly string[]
  /** What a new block of this site starts with. */
  default: string
  /** What the contract starts it with. */
  coreDefault: string
}

/** A page that holds a block, as the Block catalogue page lists it. */
export interface BlockUsage {
  /** The content type of the page. */
  uid: string
  documentId: string
  locale: string | null
  title: string
  /** `published` when the page has a published version, else `draft`. */
  state: 'draft' | 'published'
  /** The draft's `updatedAt`, the version a measurement of the page is bound to. */
  updatedAt: string | null
  /** Whether the CMS measures this type against a budget, so "Measure again" can use the page. */
  isMeasured: boolean
}
