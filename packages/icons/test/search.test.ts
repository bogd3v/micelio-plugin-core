import { describe, expect, it } from 'vitest'
import { buildIndex } from '../scripts/index-build'
import { tablerEntries } from '../scripts/tabler'
import { fold, searchIcons } from '../src/search'
import type { SpanishLabels } from '../src/types'
import spanish from '../labels/es.json'

const labels = spanish as SpanishLabels
const { icons } = buildIndex('0.0.0', tablerEntries(), {})
const namesFor = (query: string): string[] => searchIcons(icons, query, labels).map((i) => i.name)

describe('the search', () => {
  it('a query matches the English and the Spanish label', () => {
    expect(namesFor('map pin')).toContain('map-pin')
    expect(namesFor('marcador')).toContain('map-pin')
    // Accents and case do not matter, and every word must match.
    expect(namesFor('  MARCADOR de Mapa ')).toContain('map-pin')
    expect(namesFor('bombilla')).toContain('bulb')
    expect(namesFor('bulb')).toContain('bulb')
    // A name with no Spanish label is found by its English one in both languages.
    expect(namesFor('umbrella')).toContain('umbrella')
    // The category matches in both languages.
    expect(namesFor('comunicación').length).toBeGreaterThan(0)
    expect(namesFor('communication').length).toBeGreaterThan(0)
    expect(namesFor('zzzz no such icon')).toEqual([])
  })

  it('matches an alias and ranks an exact name first', () => {
    const aliased = [
      {
        name: 'leaf',
        label: 'Leaf',
        category: 'Nature',
        aliases: ['foliage'],
        filled: false,
      },
      { name: 'leaf-off', label: 'Leaf off', category: 'Nature', aliases: [], filled: false },
      { name: 'oak-leaf', label: 'Oak leaf', category: 'Nature', aliases: [], filled: false },
    ]
    expect(searchIcons(aliased, 'foliage', labels).map((i) => i.name)).toEqual(['leaf'])
    expect(searchIcons(aliased, 'leaf', labels).map((i) => i.name)).toEqual([
      'leaf',
      'leaf-off',
      'oak-leaf',
    ])
    expect(searchIcons(aliased, '', labels)).toHaveLength(3)
  })

  it('folds case, accents and separators', () => {
    expect(fold(' Árbol-de_Navidad ')).toBe('arbol de navidad')
  })
})
