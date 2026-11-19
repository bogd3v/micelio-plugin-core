import { describe, expect, it } from 'vitest'
import {
  applyOffer,
  diffTemplates,
  findFixedViolation,
  followFixed,
  planSwitch,
} from '../server/src/page-templates/changes'
import { lockedKeysOf } from '../admin/src/utils/templateFixed'
import type { TemplateBlock } from '../server/src/types/page-templates'

const block = (id: string, data: Record<string, unknown> = {}, fixed = false): TemplateBlock => ({
  block: id,
  component: `section.${id}`,
  content: 'sample',
  fixed,
  data,
})
const entry = (id: string, more: Record<string, unknown> = {}) => ({
  __component: `section.${id}`,
  ...more,
})

describe('what changed between two versions of a template', () => {
  it('lists added, removed, fixed and option changes, matching blocks by occurrence', () => {
    const before = [block('feature-grid', { columns: '4' }), block('gallery'), block('gallery')]
    const after = [
      block('feature-grid', { columns: '2' }, true),
      block('gallery'),
      block('logo-cloud'),
    ]
    expect(diffTemplates(before, after)).toEqual([
      { kind: 'fixed', block: 'feature-grid' },
      { kind: 'option', block: 'feature-grid', option: 'columns', from: '4', to: '2' },
      { kind: 'added', block: 'logo-cloud', after: 'gallery' },
      { kind: 'removed', block: 'gallery' },
    ])
  })
})

describe('applying an offer', () => {
  const base = [block('feature-grid', { columns: '4' }), block('gallery')]
  const current = [
    block('feature-grid', { columns: '2' }),
    block('gallery'),
    block('logo-cloud', { title: 'Used by' }),
  ]

  it('moves an option only where the page kept the old value', () => {
    const kept = applyOffer(
      [entry('feature-grid', { columns: '4' }), entry('gallery')],
      [],
      base,
      current
    )
    expect(kept.zone[0]).toMatchObject({ columns: '2' })
    const edited = applyOffer(
      [entry('feature-grid', { columns: '3' }), entry('gallery')],
      [],
      base,
      current
    )
    expect(edited.zone[0]).toMatchObject({ columns: '3' })
  })

  it('adds the new block after its predecessor, once, and removes nothing', () => {
    const zone = [entry('gallery'), entry('feature-grid', { columns: '4' })]
    const once = applyOffer(zone, [], base, current)
    expect(once.zone.map(({ __component }) => __component)).toEqual([
      'section.gallery',
      'section.logo-cloud',
      'section.feature-grid',
    ])
    expect(once.added).toHaveLength(1)
    // A page that already holds that block gets no second one.
    const again = applyOffer(once.zone, [], base, current)
    expect(again.zone).toHaveLength(3)
    expect(again.added).toEqual([])
  })

  it('makes the fixed marks follow the template', () => {
    const fixedNow = [block('feature-grid', {}, true), block('gallery')]
    const result = applyOffer(
      [entry('feature-grid'), entry('gallery')],
      [{ block: 'gallery', nth: 1 }],
      [block('feature-grid'), block('gallery', {}, true)],
      fixedNow
    )
    expect(result.fixed).toEqual([{ block: 'feature-grid', nth: 1 }])
  })
})

describe('switching', () => {
  it('keeps the blocks that fit, adds the rest and lists what is dropped', () => {
    const result = planSwitch(
      [entry('feature-grid'), entry('gallery', { body: 'Mine' })],
      [block('gallery', { body: 'Theirs' }, true), block('scene')]
    )
    expect(result.plan).toEqual({
      keeps: ['gallery'],
      adds: ['scene'],
      drops: [{ block: 'feature-grid', position: 0 }],
    })
    expect(result.zone[0]).toMatchObject({ body: 'Mine' })
    expect(result.fixed).toEqual([{ block: 'gallery', nth: 1 }])
  })
})

describe('a fixed block', () => {
  const stored = [
    entry('feature-grid', { id: 1 }),
    entry('gallery', { id: 1 }),
    entry('logo-cloud', { id: 1 }),
  ]
  const marks = [
    { block: 'feature-grid', nth: 1 },
    { block: 'logo-cloud', nth: 1 },
  ]
  it('may not be removed or moved past another fixed block', () => {
    expect(findFixedViolation(stored, [stored[1], stored[2]], marks)).toEqual({
      block: 'feature-grid',
      reason: 'removed',
    })
    expect(findFixedViolation(stored, [stored[2], stored[1], stored[0]], marks)).toEqual({
      block: 'logo-cloud',
      reason: 'moved',
    })
    expect(findFixedViolation(stored, [stored[0], stored[2], stored[1]], marks)).toBeNull()
  })
  it('is found by its row, not by its place among the blocks of its type', () => {
    // A new grid before the fixed one is not the fixed grid: the mark stays on the stored row.
    expect(findFixedViolation(stored, [entry('feature-grid'), ...stored], marks)).toBeNull()
    // Removing the fixed grid while a new one stands in for it is a removal.
    expect(
      findFixedViolation(stored, [entry('feature-grid'), stored[1], stored[2]], marks)
    ).toEqual({ block: 'feature-grid', reason: 'removed' })
    // After the insert, the original (now the second grid) is still the one that is fixed.
    const inserted = [entry('feature-grid', { id: 2 }), ...stored]
    expect(findFixedViolation(stored, inserted.slice(1), marks)).toBeNull()
    expect(
      findFixedViolation(inserted, inserted.slice(2), [{ block: 'feature-grid', nth: 2 }])
    ).toEqual({ block: 'feature-grid', reason: 'removed' })
  })
  it('keeps its mark when a block of its type is put before it', () => {
    const edited = [entry('feature-grid'), ...stored]
    expect(followFixed(stored, edited, marks)).toEqual([
      { block: 'feature-grid', nth: 2 },
      { block: 'logo-cloud', nth: 1 },
    ])
    expect(followFixed(stored, stored, marks)).toEqual(marks)
  })
  it('counts a block sent without its id as new', () => {
    const noIds = stored.map(({ __component }) => ({ __component }))
    expect(findFixedViolation(stored, noIds, marks)).toEqual({
      block: 'feature-grid',
      reason: 'removed',
    })
  })
  it('locks nothing the stored zone does not hold', () => {
    expect(findFixedViolation([entry('gallery', { id: 1 })], [], marks)).toBeNull()
  })
})

describe('the blocks the builder locks', () => {
  const held = [
    { component: 'section.feature-grid', id: 7 },
    { component: 'section.gallery', id: 8 },
  ]
  const idOf = ({ component }: { component: string }) => component.replace('section.', '')
  const marks = [{ block: 'feature-grid', nth: 1 }]
  it('locks the block that carries the marked row, not the first of its type', () => {
    // A grid added before the fixed one, not saved yet, has no id and is not the fixed grid.
    const blocks = [
      { key: 'new', component: 'section.feature-grid' },
      { key: 'a', component: 'section.feature-grid', id: 7 },
      { key: 'b', component: 'section.gallery', id: 8 },
    ]
    expect([...lockedKeysOf(blocks, held, marks, idOf)]).toEqual(['a'])
  })
  it('keeps the lock on the row when the block moves', () => {
    const blocks = [
      { key: 'b', component: 'section.gallery', id: 8 },
      { key: 'a', component: 'section.feature-grid', id: 7 },
    ]
    expect([...lockedKeysOf(blocks, held, marks, idOf)]).toEqual(['a'])
  })
})
