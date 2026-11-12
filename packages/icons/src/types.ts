// What the index, the labels and the search share.

/** The two styles Tabler draws; `filled` exists for about a thousand names. */
export type GlyphStyle = 'outline' | 'filled'

/** The languages a label is written in. */
export type Locale = 'en' | 'es'

/** One name of the catalogue, as `index.json` lists it. */
export interface IconEntry {
  /** The name a block stores: `map-pin`. */
  name: string
  /** The English label, the name in sentence case: `Map pin`. */
  label: string
  /** Tabler's category, in English: `Map`. */
  category: string
  /** What the picker also searches: Tabler's tags and the names this one replaced. */
  aliases: string[]
  /** Whether a filled glyph exists besides the outline one. */
  filled: boolean
}

/** `index.json`: what the core bundles; the glyphs are read on demand. */
export interface IconIndex {
  set: 'tabler'
  /** The Tabler version the index and the glyphs come from. */
  version: string
  /** The categories, in English. */
  categories: string[]
  /** A name Tabler renamed or removed, and the name that replaces it (`contract/icons.ts`). */
  aliases: Record<string, string>
  icons: IconEntry[]
}

/** `labels/es.json`: the Spanish labels, for every category and the names the core uses. */
export interface SpanishLabels {
  categories: Record<string, string>
  names: Record<string, string>
}
