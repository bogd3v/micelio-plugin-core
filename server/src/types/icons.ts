// What `GET /micelio/icons` answers, and the part of `@micelio/icons` the server reads.
import type { IconEntry, IconIndex, Locale, SpanishLabels } from '../../../packages/icons/src/types'

export type { IconEntry, IconIndex, Locale, SpanishLabels }

/** Where a glyph comes from: the core's drawing, or the one the site's active theme redraws. */
export type IconSource = 'core' | 'theme'

/** One entry of the sprite a site resolves. */
export interface IconAnswerEntry {
  /** The name a field stores: `bolt`. */
  name: string
  /** The label in the requested language: the English one when there is no Spanish label. */
  label: string
  /** Tabler's category, in English. */
  category: string
  aliases: string[]
  /** Whether a filled glyph exists besides the outline one. */
  filled: boolean
  /** Whose drawing `glyph` is. */
  source: IconSource
  /** The normalised SVG, one level of `currentColor`: the admin renders it as it is. */
  glyph: string
}

/** The answer of `GET /micelio/icons`. */
export interface IconsAnswer {
  /** The set the catalogue pins. */
  set: 'tabler'
  /** The pinned version of the set. */
  version: string
  /** Every name of the catalogue, whatever the query. */
  total: number
  /** How many names the query matches; `entries` holds at most `limit` of them. */
  count: number
  categories: { name: string; label: string }[]
  entries: IconAnswerEntry[]
}

/** The functions of `@micelio/icons` the server calls. */
export interface IconsModule {
  loadIndex(): Promise<IconIndex>
  loadSpanishLabels(): Promise<SpanishLabels>
  readGlyph(name: string): Promise<string | undefined>
  searchIcons(icons: readonly IconEntry[], query: string, labels: SpanishLabels): IconEntry[]
  labelOf(entry: IconEntry, locale: Locale, labels: SpanishLabels): string
  categoryLabelOf(category: string, locale: Locale, labels: SpanishLabels): string
}
