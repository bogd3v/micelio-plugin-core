import { describe, expect, it } from 'vitest'
import { BLOCKS, type Block } from '../contract/blocks'
import {
  catalogueFingerprint,
  diffFingerprints,
  isCatalogueFingerprint,
} from '../server/src/utils/block-catalogue'

const NOTHING = { added: [], changed: [], removed: [] }

function withBlock(id: string, change: (block: Block) => Block): Block[] {
  return BLOCKS.map((block) => (block.id === id ? change(block) : block))
}

describe('the fingerprint of the block catalogue', () => {
  const current = catalogueFingerprint(BLOCKS)

  it('has one hash per block', () => {
    expect(Object.keys(current)).toEqual(BLOCKS.map((block) => block.id))
    expect(Object.values(current).every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true)
  })

  it('is the same for the same catalogue, whatever the order of its keys', () => {
    const reordered = BLOCKS.map((block) => ({
      static: block.static,
      cost: { island: block.cost.island, js: block.cost.js, css: block.cost.css },
      options: block.options,
      schema: block.schema,
      group: block.group,
      id: block.id,
    }))
    expect(catalogueFingerprint(reordered)).toEqual(current)
    expect(diffFingerprints(current, catalogueFingerprint(BLOCKS))).toEqual(NOTHING)
  })

  it.each<[string, (block: Block) => Block]>([
    [
      'its cost',
      (block: Block) => ({ ...block, cost: { ...block.cost, css: block.cost.css + 1 } }),
    ],
    ['its static alternative', (block: Block) => ({ ...block, static: `${block.static} More.` })],
    [
      'its options',
      (block: Block) => ({ ...block, options: { variant: { values: ['a', 'b'], default: 'a' } } }),
    ],
    [
      'its schema',
      (block: Block) => ({
        ...block,
        schema: { ...block.schema, fields: block.schema.fields.omit({ text: true }) },
      }),
    ],
  ])('sees a block as changed when only %s changes', (_, change) => {
    const next = catalogueFingerprint(withBlock('hero', change))
    expect(diffFingerprints(current, next)).toEqual({ added: [], changed: ['hero'], removed: [] })
  })

  it('sees added, changed and removed blocks, sorted by id', () => {
    const previous: Record<string, string> = { ...current, stats: 'an older hash' }
    delete previous.quote
    delete previous.faq
    previous['retired-block'] = 'a hash'
    expect(diffFingerprints(previous, current)).toEqual({
      added: ['faq', 'quote'],
      changed: ['stats'],
      removed: ['retired-block'],
    })
  })

  it('sees every block as added when nothing was stored', () => {
    expect(diffFingerprints({}, current)).toEqual({
      added: BLOCKS.map((block) => block.id).sort(),
      changed: [],
      removed: [],
    })
  })

  it('tells a stored fingerprint from anything else', () => {
    expect(isCatalogueFingerprint(current)).toBe(true)
    expect(isCatalogueFingerprint({})).toBe(true)
    for (const value of [null, 'hash', ['a'], { hero: 1 }]) {
      expect(isCatalogueFingerprint(value)).toBe(false)
    }
  })
})
