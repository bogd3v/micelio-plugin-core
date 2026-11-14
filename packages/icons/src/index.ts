// `@micelio/icons`: the Tabler set the block contract pins (`contract/icons.ts` of
// `@micelio/strapi-plugin-core`), normalised. The index and the Spanish labels are read once; a
// glyph is read from disk when it is asked for, never all at once.
//
// Every read names its file inline, as `new URL(<literal>, import.meta.url)` relative to this
// module: a file tracer (`@vercel/nft`, the one Nitro uses) follows only that shape, so a host's
// server build copies `index.json`, `labels/es.json` and `glyphs/*/*.svg` (the template literal of
// `readGlyph` is a glob to it) next to `dist/`. Do not move a path into a variable or a helper
// that takes a name (`readJson` takes the URL): the tracer cannot resolve it and a bundled server then has no data. The folder
// comes from `folderOf`, not from a ternary in `readGlyph`: the tracer reads a `const` ternary as
// two known values, gives up on the template and emits no glyph (`test/package.test.ts` checks it).
import { readFile } from 'node:fs/promises'
import type { GlyphStyle, IconIndex, SpanishLabels } from './types.js'

export type { GlyphStyle, IconEntry, IconIndex, Locale, SpanishLabels } from './types.js'
export { categoryLabelOf, fold, labelOf, searchIcons } from './search.js'

let index: Promise<IconIndex> | undefined
let spanish: Promise<SpanishLabels> | undefined

// Takes the URL, never a name: the caller writes the literal, where the tracer reads it.
async function readJson<T>(file: URL): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}

/** The index of the catalogue: every name with its labels, category and aliases. */
export function loadIndex(): Promise<IconIndex> {
  index ??= readJson<IconIndex>(new URL('../index.json', import.meta.url))
  return index
}

/** The Spanish labels: every category and the names the core uses. */
export function loadSpanishLabels(): Promise<SpanishLabels> {
  spanish ??= readJson<SpanishLabels>(new URL('../labels/es.json', import.meta.url))
  return spanish
}

function folderOf(style: GlyphStyle, filled: boolean): GlyphStyle {
  return style === 'filled' && filled ? 'filled' : 'outline'
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
  const folder = folderOf(style, entry.filled)
  return readFile(new URL(`../glyphs/${folder}/${resolved}.svg`, import.meta.url), 'utf8')
}
