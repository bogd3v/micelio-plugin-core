// The index of the catalogue, made from Tabler's `icons.json`. Pure: `generate.ts` reads and writes.
import type { IconEntry, IconIndex } from '../src/types'

/** The part of an entry of Tabler's `icons.json` the index reads. */
export interface TablerEntry {
  name: string
  category: string
  tags: string[]
  styles: { outline?: unknown; filled?: unknown }
}

/** The English label of a name: its words, in sentence case (`map-pin` is `Map pin`). */
export function englishLabel(name: string): string {
  const words = name.replaceAll('-', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The index of a Tabler version: one entry per name, sorted by name, with the aliases of its
 * tags and of the names it replaced (`aliases`, the table of `contract/icons.ts`).
 */
export function buildIndex(
  version: string,
  tabler: Record<string, TablerEntry>,
  aliases: Readonly<Record<string, string>>
): IconIndex {
  const replaced = new Map<string, string[]>()
  for (const [old, name] of Object.entries(aliases)) {
    replaced.set(name, [...(replaced.get(name) ?? []), old])
  }
  const icons: IconEntry[] = Object.values(tabler)
    .map((entry) => ({
      name: entry.name,
      label: englishLabel(entry.name),
      category: entry.category,
      aliases: [...new Set([...(replaced.get(entry.name) ?? []), ...entry.tags.map(String)])],
      filled: entry.styles.filled !== undefined,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
  return {
    set: 'tabler',
    version,
    categories: [...new Set(icons.map((icon) => icon.category))].sort(),
    aliases: { ...aliases },
    icons,
  }
}
