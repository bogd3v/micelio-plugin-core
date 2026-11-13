import { ICONS_DEFAULT_LIMIT, ICONS_MAX_LIMIT } from '../constants/icons'
import type { IconsAnswer, IconsModule, IconSource, Locale } from '../types/icons'

/** What a request for icons asks. */
export interface IconsQuery {
  /** Words to find in a name, a label (either language), a category or an alias. */
  q?: string
  /** Exactly this name, or the name this alias points to: the entry a stored value shows. */
  name?: string
  /** The aliases to resolve `name` with: the catalogue's, which the save checks against. */
  aliases?: Readonly<Record<string, string>>
  /** One category, by its English name. */
  category?: string
  /** The language of the labels; the search matches both. */
  locale?: Locale
  /** At most this many entries, `ICONS_DEFAULT_LIMIT` by default and `ICONS_MAX_LIMIT` at most. */
  limit?: number
  /** Matches to skip. */
  offset?: number
}

// The specifier is a variable: the package is ESM and its types exist once it is built, which
// `npm run typecheck` does not wait for. Node 22 requires an ES module as it imports one.
const SPECIFIER = '@micelio/icons'
let loaded: Promise<IconsModule> | undefined
const icons = (): Promise<IconsModule> => (loaded ??= import(SPECIFIER) as Promise<IconsModule>)

/**
 * Whose drawing an icon is for a site: the one its active theme redraws, else the core's.
 *
 * @remarks
 * ADR-0021, section 5. In step 1 no theme redraws a glyph, so every entry is the core's; the
 * answer already carries the `source` so that step 2 changes this function and nothing around it.
 */
export function sourceOf(_site: string | undefined, _name: string): IconSource {
  return 'core'
}

/**
 * The entries of the sprite a site resolves, filtered by a query.
 *
 * @param site - The slug of a known site, or `undefined` for the core's own entries.
 */
export async function readIcons(
  site: string | undefined,
  query: IconsQuery = {}
): Promise<IconsAnswer> {
  const { loadIndex, loadSpanishLabels, readGlyph, searchIcons, labelOf, categoryLabelOf } =
    await icons()
  const [index, labels] = await Promise.all([loadIndex(), loadSpanishLabels()])
  const locale = query.locale ?? 'en'
  const aliases = { ...index.aliases, ...query.aliases }
  const wanted =
    query.name === undefined
      ? undefined
      : Object.prototype.hasOwnProperty.call(aliases, query.name)
        ? aliases[query.name]
        : query.name
  const pool = index.icons.filter(
    (entry) =>
      (query.category === undefined || entry.category === query.category) &&
      (wanted === undefined || entry.name === wanted)
  )
  const found = searchIcons(pool, query.q ?? '', labels)
  const limit = Math.min(Math.max(query.limit ?? ICONS_DEFAULT_LIMIT, 1), ICONS_MAX_LIMIT)
  const page = found.slice(query.offset ?? 0, (query.offset ?? 0) + limit)
  const entries = await Promise.all(
    page.map(async (entry) => ({
      name: entry.name,
      label: labelOf(entry, locale, labels),
      category: entry.category,
      aliases: entry.aliases,
      filled: entry.filled,
      source: sourceOf(site, entry.name),
      glyph: (await readGlyph(entry.name)) ?? '',
    }))
  )
  return {
    set: index.set,
    version: index.version,
    total: index.icons.length,
    count: found.length,
    categories: index.categories.map((name) => ({
      name,
      label: categoryLabelOf(name, locale, labels),
    })),
    entries,
  }
}
