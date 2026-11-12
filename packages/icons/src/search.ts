// The search of the picker and the labels it shows, as pure functions of the index and the Spanish
// labels. The query matches the English and the Spanish label (decision of 2026-11-12, ADR-0021
// section 2): a name without a Spanish label has its English label in both languages.
import type { IconEntry, Locale, SpanishLabels } from './types.js'

/** Lower case, without accents, one space between words: how a query and a label are compared. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[-_\s]+/g, ' ')
    .trim()
}

/** The label of an entry in a language: the Spanish one when there is one, else the English one. */
export function labelOf(entry: IconEntry, locale: Locale, labels: SpanishLabels): string {
  return locale === 'es' ? (labels.names[entry.name] ?? entry.label) : entry.label
}

/** The label of a category in a language: the English name when it has no Spanish label. */
export function categoryLabelOf(category: string, locale: Locale, labels: SpanishLabels): string {
  return locale === 'es' ? (labels.categories[category] ?? category) : category
}

/**
 * The entries a query finds, best first: every word of the query must be inside the name, a
 * label (English or Spanish), the category (English or Spanish) or an alias. An exact name comes
 * first, then a name that starts with the query, then the rest by name. An empty query finds all.
 */
export function searchIcons(
  icons: readonly IconEntry[],
  query: string,
  labels: SpanishLabels
): IconEntry[] {
  const folded = fold(query)
  if (!folded) return [...icons]
  const words = folded.split(' ')
  const found: { entry: IconEntry; rank: number }[] = []
  for (const entry of icons) {
    const name = fold(entry.name)
    const haystack = [
      name,
      fold(entry.label),
      fold(labels.names[entry.name] ?? ''),
      fold(entry.category),
      fold(labels.categories[entry.category] ?? ''),
      ...entry.aliases.map(fold),
    ].join('|')
    if (!words.every((word) => haystack.includes(word))) continue
    found.push({ entry, rank: name === folded ? 0 : name.startsWith(folded) ? 1 : 2 })
  }
  return found
    .sort((a, b) => a.rank - b.rank || (a.entry.name < b.entry.name ? -1 : 1))
    .map(({ entry }) => entry)
}
