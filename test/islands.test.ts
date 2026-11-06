import { describe, expect, it } from 'vitest'
import { ON_CLICK_ABOVE_KB, isFilled, triggerOf } from '../contract/islands'
import { findBackgroundSceneExcess, findMissingAlternatives } from '../server/src/islands/rules'
import { missingAlternative, weightText } from '../admin/src/utils/builder/islands'

const scene = (content: object = {}) => ({ __component: 'section.scene', ...content })

describe('what counts as a filled field of a static alternative', () => {
  it.each([
    ['text', 'A poster', true],
    ['a file', { id: 3, name: 'poster.png' }, true],
    ['a list with a member', [1], true],
    ['zero', 0, true],
    ['nothing', undefined, false],
    ['null', null, false],
    ['an empty text', '', false],
    ['a blank text', ' \n\t', false],
    ['an empty list', [], false],
  ])('%s', (_name, value, expected) => {
    expect(isFilled(value)).toBe(expected)
  })
})

describe('the load rule of an island', () => {
  it('loads on a click above 1 MB and in view at or below it', () => {
    expect(ON_CLICK_ABOVE_KB).toBe(1024)
    expect(triggerOf(1024)).toBe('view')
    expect(triggerOf(1024.1)).toBe('click')
    expect(triggerOf(151.3)).toBe('view')
  })

  it('writes a weight in kB with one decimal, and in MB from 1024 kB', () => {
    expect(weightText(151.27)).toEqual({ unit: 'kb', value: 151.3 })
    expect(weightText(1023.9)).toEqual({ unit: 'kb', value: 1023.9 })
    expect(weightText(1024)).toEqual({ unit: 'mb', value: 1 })
    expect(weightText(1946)).toEqual({ unit: 'mb', value: 1.9 })
  })
})

describe('the static alternative of the islands of a zone', () => {
  it('names each island block that lacks fields, by position, with the empty ones in the contract order', () => {
    expect(
      findMissingAlternatives([
        { __component: 'section.rich-text', body: 'text' },
        scene({ alt: ' ', poster: { id: 1 } }),
        scene({}),
        { __component: 'shared.playground', runtime: 'sql', code: 'select 1' },
        { __component: 'shared.playground', expectedOutput: '1' },
      ])
    ).toEqual([
      { block: 'scene', position: 1, fields: ['alt'] },
      { block: 'scene', position: 2, fields: ['poster', 'alt'] },
      { block: 'playground', position: 3, fields: ['expectedOutput'] },
    ])
  })

  it('gives nothing for a complete island, a block that is not one, and a component of the host', () => {
    expect(
      findMissingAlternatives([
        scene({ poster: { id: 1 }, alt: 'A scene' }),
        { __component: 'section.hero', title: 'Hi' },
        { __component: 'fixture.link' },
        null,
        'text',
      ])
    ).toEqual([])
  })
})

describe('the background Scene of a page', () => {
  it('allows one, and any number of inline ones', () => {
    expect(
      findBackgroundSceneExcess([scene({ variant: 'background' }), scene({ variant: 'inline' })])
    ).toBeNull()
    expect(
      findBackgroundSceneExcess([scene({ variant: 'inline' }), scene({ variant: 'inline' })])
    ).toBeNull()
    expect(findBackgroundSceneExcess([])).toBeNull()
  })

  it('counts a Scene that sets no variant as a background one (its default)', () => {
    expect(findBackgroundSceneExcess([scene(), scene()])).toEqual({
      block: 'scene',
      count: 2,
      limit: 1,
    })
    expect(
      findBackgroundSceneExcess([scene({ variant: null }), scene({ variant: 'background' })])
    ).not.toBeNull()
    expect(findBackgroundSceneExcess([scene(), scene({ variant: 'inline' })])).toBeNull()
  })

  it('refuses a second one and says how many the zone holds', () => {
    expect(
      findBackgroundSceneExcess([
        scene({ variant: 'background' }),
        { __component: 'section.hero', variant: 'background' },
        scene({ variant: 'background' }),
        scene({ variant: 'background' }),
      ])
    ).toEqual({ block: 'scene', count: 3, limit: 1 })
  })
})

describe('the fields of an island the block leaves empty', () => {
  it('reads the island of the entry, and says which alternative fields are empty', () => {
    const island = {
      kind: '3d',
      loadKb: 1,
      trigger: 'view',
      alternative: ['poster', 'alt'],
    } as const
    expect(missingAlternative(island, { poster: null, alt: 'x' })).toEqual(['poster'])
    expect(missingAlternative(island, { poster: { id: 1 }, alt: 'x' })).toEqual([])
  })
})
