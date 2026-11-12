// `@micelio/icons`: the Tabler set the block contract pins (`contract/icons.ts` of
// `@micelio/strapi-plugin-core`), normalised. The index and the Spanish labels are read once; a
// glyph is read from disk when it is asked for, never all at once.
import { readFile } from 'node:fs/promises'
import type { GlyphStyle, IconIndex, SpanishLabels } from './types.js'

export type { GlyphStyle, IconEntry, IconIndex, Locale, SpanishLabels } from './types.js'
export { categoryLabelOf, fold, labelOf, searchIcons } from './search.js'

const PACKAGE = new URL('../', import.meta.url)
let index: Promise<IconIndex> | undefined
let spanish: Promise<SpanishLabels> | undefined

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(new URL(file, PACKAGE), 'utf8')) as T
}

/** The index of the catalogue: every name with its labels, category and aliases. */
export function loadIndex(): Promise<IconIndex> {
  index ??= readJson<IconIndex>('index.json')
  return index
}

/** The Spanish labels: every category and the names the core uses. */
export function loadSpanishLabels(): Promise<SpanishLabels> {
  spanish ??= readJson<SpanishLabels>('labels/es.json')
  return spanish
}

/**
 * The normalised SVG of a name, or `undefined` when the catalogue has no such name. A name Tabler
 * renamed or removed answers the glyph of the name that replaced it; `filled` falls back to
 * `outline` for a name with no filled alternate.
 */
export async function readGlyph(
  name: string,
  style: GlyphStyle = 'outline'
): Promise<string | undefined> {
  const { aliases, icons } = await loadIndex()
  const resolved = Object.hasOwn(aliases, name) ? aliases[name] : name
  const entry = icons.find((icon) => icon.name === resolved)
  if (!entry) return undefined
  const folder = style === 'filled' && entry.filled ? 'filled' : 'outline'
  return readFile(new URL(`glyphs/${folder}/${resolved}.svg`, PACKAGE), 'utf8')
}
