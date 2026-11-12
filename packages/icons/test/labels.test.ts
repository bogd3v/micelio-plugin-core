import { describe, expect, it } from 'vitest'
import { CORE_NAMES, DEFAULT_NAMES, SUGGESTED_NAMES } from '../labels/core-names'
import { buildIndex } from '../scripts/index-build'
import { tablerEntries } from '../scripts/tabler'
import { categoryLabelOf, labelOf } from '../src/search'
import type { IconEntry, SpanishLabels } from '../src/types'
import spanish from '../labels/es.json'

const labels = spanish as SpanishLabels
const index = buildIndex('0.0.0', tablerEntries(), {})

describe('the Spanish labels', () => {
  it('every category and every name of core-names.ts has a Spanish label', () => {
    expect(index.categories.filter((category) => !labels.categories[category])).toEqual([])
    expect(CORE_NAMES.filter((name) => !labels.names[name])).toEqual([])
  })

  it('a name without a Spanish label answers its English label in Spanish', () => {
    const names = new Set(index.icons.map((icon) => icon.name))
    const without = index.icons.find((icon) => !labels.names[icon.name]) as IconEntry
    expect(labelOf(without, 'es', labels)).toBe(without.label)
    expect(labelOf(without, 'en', labels)).toBe(without.label)
    const pin = index.icons.find((icon) => icon.name === 'map-pin') as IconEntry
    expect(labelOf(pin, 'es', labels)).toBe('Marcador de mapa')
    expect(labelOf(pin, 'en', labels)).toBe('Map pin')
    expect(categoryLabelOf('Map', 'es', labels)).toBe('Mapa')
    expect(categoryLabelOf('Not a category', 'es', labels)).toBe('Not a category')
    expect(categoryLabelOf('Map', 'en', labels)).toBe('Map')
    // A label of a name that is not in the set would be dead weight that never shows.
    expect(Object.keys(labels.names).filter((name) => !names.has(name))).toEqual([])
    expect(Object.keys(labels.categories).filter((c) => !index.categories.includes(c))).toEqual([])
  })

  it('keeps the core names to the ones the four step-1 fields and the defaults use', () => {
    expect(Object.keys(SUGGESTED_NAMES)).toEqual(['feature-item', 'link', 'stat', 'plan.features'])
    expect(DEFAULT_NAMES.length).toBeGreaterThan(0)
    expect(new Set(CORE_NAMES).size).toBe(CORE_NAMES.length)
  })
})
