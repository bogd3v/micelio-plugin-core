import { describe, expect, it } from 'vitest'
import { EMPTY_HISTORY, HISTORY_LIMIT, remember, undo } from '../admin/src/utils/builder/history'
import {
  adoptIds,
  duplicate,
  forgetGoneItems,
  forgetUnknownIds,
  insertAt,
  moveBy,
  moveTo,
  readBlocks,
  removeKey,
  setFields,
  storedIds,
  withoutHiddenOptions,
  writeBlocks,
  type BuilderBlock,
  type ComponentSchemas,
} from '../admin/src/utils/builder/model'
import { refusalOf, refusedBlockOf, VERSION_CONFLICT } from '../admin/src/utils/builder/refusal'
import { VERSION_CONFLICT as SERVER_CODE } from '../server/src/constants/document-version'

const block = (key: string, component = 'section.rich-text', id?: number): BuilderBlock => ({
  key,
  component,
  ...(id === undefined ? {} : { id }),
  fields: { body: key },
})
const keys = (blocks: BuilderBlock[]) => blocks.map((b) => b.key)
// The component schemas the catalogue reads: items are components, a logo's image is media.
const schemas: ComponentSchemas = {
  'section.feature-grid': {
    uid: 'section.feature-grid',
    attributes: {
      title: { type: 'string' },
      items: { type: 'component', repeatable: true, component: 'section.feature-item' },
    },
  },
  'section.feature-item': {
    uid: 'section.feature-item',
    attributes: {
      title: { type: 'string' },
      links: { type: 'component', repeatable: true, component: 'shared.link' },
    },
  },
  'shared.link': { uid: 'shared.link', attributes: { label: { type: 'string' } } },
  'section.logo-cloud': {
    uid: 'section.logo-cloud',
    attributes: { items: { type: 'component', repeatable: true, component: 'section.logo' } },
  },
  'section.logo': {
    uid: 'section.logo',
    attributes: { image: { type: 'media' }, gallery: { type: 'media' } },
  },
}

describe('the builder’s document model', () => {
  it('reads a dynamic zone into blocks and writes it back with the stored ids', () => {
    const zone = [
      { __component: 'section.hero', id: 3, title: 'Hi' },
      { __component: 'section.cta', title: 'New' },
      'not a component',
      { title: 'no component' },
    ]
    const blocks = readBlocks(zone)
    expect(blocks.map((b) => [b.component, b.id, b.fields])).toEqual([
      ['section.hero', 3, { title: 'Hi' }],
      ['section.cta', undefined, { title: 'New' }],
    ])
    expect(writeBlocks(blocks)).toEqual([
      { id: 3, __component: 'section.hero', title: 'Hi' },
      { __component: 'section.cta', title: 'New' },
    ])
    expect(readBlocks(undefined)).toEqual([])
  })

  it('inserts, moves and removes by key, clamping at the ends', () => {
    const list = [block('a'), block('b'), block('c')]
    expect(keys(insertAt(list, 1, block('x')))).toEqual(['a', 'x', 'b', 'c'])
    expect(keys(insertAt(list, 99, block('x')))).toEqual(['a', 'b', 'c', 'x'])
    expect(keys(insertAt(list, -4, block('x')))).toEqual(['x', 'a', 'b', 'c'])
    expect(keys(moveBy(list, 'c', -1))).toEqual(['a', 'c', 'b'])
    expect(moveBy(list, 'a', -1)).toBe(list)
    expect(moveBy(list, 'c', 1)).toBe(list)
    expect(keys(moveTo(list, 'a', 2))).toEqual(['b', 'c', 'a'])
    expect(moveTo(list, 'zz', 0)).toBe(list)
    expect(keys(removeKey(list, 'b'))).toEqual(['a', 'c'])
  })

  it('keeps the key of a block through a move, so the selection and the history still find it', () => {
    const list = [block('a', 'section.hero', 1), block('b', 'section.cta', 1)]
    const moved = moveBy(list, 'b', -1)
    expect(moved[0]).toBe(list[1])
  })

  it('duplicates a block with a new key and without Strapi ids, its items’ included', () => {
    const original: BuilderBlock = {
      key: 'a',
      id: 7,
      component: 'section.feature-grid',
      fields: {
        title: 'T',
        items: [
          { id: 4, title: 'One' },
          { id: 5, title: 'Two' },
        ],
      },
    }
    const copy = duplicate(original, schemas)
    expect(copy.key).not.toBe('a')
    expect(copy.id).toBeUndefined()
    expect(copy.fields).toEqual({ title: 'T', items: [{ title: 'One' }, { title: 'Two' }] })
    expect(original.fields.items).toEqual([
      { id: 4, title: 'One' },
      { id: 5, title: 'Two' },
    ])
  })

  it('lays fields over one block only', () => {
    const list = [block('a'), block('b')]
    const next = setFields(list, 'b', { body: 'changed', extra: 1 })
    expect(next[0]).toBe(list[0])
    expect(next[1]!.fields).toEqual({ body: 'changed', extra: 1 })
  })

  it('gives a saved block the id the CMS answered and never replaces one it has', () => {
    const saved = [block('a'), block('b', 'section.cta', 9)]
    const answered = [
      { __component: 'section.rich-text', id: 11 },
      { __component: 'section.cta', id: 12 },
    ]
    const adopted = adoptIds(saved, answered, saved)
    expect(adopted.map((b) => b.id)).toEqual([11, 9])
    // A component that is not the one that was sent is not matched by position.
    expect(adoptIds(saved, [{ __component: 'section.hero', id: 1 }], saved)[0]!.id).toBeUndefined()
    expect(adoptIds(saved, 'nope', saved)).toEqual(saved)
  })

  it('forgets the id of a block the last save no longer holds (an undone removal comes back as new)', () => {
    const stored = storedIds([block('a', 'section.hero', 1)])
    const brought = [block('a', 'section.hero', 1), block('b', 'section.cta', 1)]
    const result = forgetUnknownIds(brought, stored, schemas)
    expect(result[0]!.id).toBe(1)
    // Ids are per component: `section.cta` 1 is not `section.hero` 1.
    expect(result[1]!.id).toBeUndefined()
    expect(result[1]!.key).toBe('b')
  })

  it('leaves out the options a block does not expose when it is sent', () => {
    const grid: BuilderBlock = {
      key: 'g',
      component: 'section.feature-grid',
      fields: { title: 'T', columns: '3', density: 'compact', width: 'prose' },
    }
    const entries = [{ component: 'section.feature-grid', options: { columns: {}, density: {} } }]
    expect(withoutHiddenOptions(grid, entries).fields).toEqual({
      title: 'T',
      columns: '3',
      density: 'compact',
    })
    expect(withoutHiddenOptions(grid, undefined)).toBe(grid)
    // A block the site disabled has no entry: it is sent with no option at all, as the CMS wants.
    expect(withoutHiddenOptions({ ...grid, component: 'section.other' }, entries).fields).toEqual({
      title: 'T',
    })
  })

  it('forgets the id of an item the other session removed, and keeps the others', () => {
    const mine: BuilderBlock[] = [
      {
        key: 'a',
        id: 1,
        component: 'section.feature-grid',
        fields: {
          title: 'Mine',
          items: [
            { id: 10, title: 'A' },
            { id: 11, title: 'B', links: [{ id: 5, label: 'x' }] },
          ],
        },
      },
      { key: 'b', id: 2, component: 'section.logo-cloud', fields: { items: [{ id: 7 }] } },
    ]
    const theirs: BuilderBlock[] = [
      {
        key: 'x',
        id: 1,
        component: 'section.feature-grid',
        fields: { title: 'Grid', items: [{ id: 10, title: 'A' }] },
      },
    ]
    const result = forgetGoneItems(mine, theirs, schemas)
    expect(result[0]!.fields).toEqual({
      title: 'Mine',
      items: [
        { id: 10, title: 'A' },
        { title: 'B', links: [{ label: 'x' }] },
      ],
    })
    // A block theirs lacks is left to forgetUnknownIds.
    expect(result[1]).toBe(mine[1])
  })

  it('forgets the ids of the items of a block the last save no longer holds', () => {
    const stored = storedIds([])
    const brought: BuilderBlock[] = [
      {
        key: 'g',
        id: 4,
        component: 'section.feature-grid',
        fields: { title: 'T', items: [{ id: 10, title: 'A', links: [{ id: 3, label: 'x' }] }] },
      },
    ]
    const [again] = forgetUnknownIds(brought, stored, schemas)
    expect(again!.id).toBeUndefined()
    expect(again!.fields).toEqual({ title: 'T', items: [{ title: 'A', links: [{ label: 'x' }] }] })
  })

  it('keeps the ids of files and relations, which name what they point at', () => {
    const logo = { id: 8, image: { id: 21, name: 'a.png', url: '/a.png' }, gallery: [{ id: 22 }] }
    const grid: BuilderBlock = {
      key: 'l',
      id: 1,
      component: 'section.logo-cloud',
      fields: { items: [logo] },
    }
    const gone = forgetGoneItems([grid], [{ ...grid, fields: { items: [] } }], schemas)[0]!
    expect(gone.fields).toEqual({
      items: [{ image: { id: 21, name: 'a.png', url: '/a.png' }, gallery: [{ id: 22 }] }],
    })
    // A copy and a block that comes back as new lose the id of the item, not of its image.
    expect(duplicate(grid, schemas).fields).toEqual(gone.fields)
    expect(forgetUnknownIds([grid], new Set(), schemas)[0]!.fields).toEqual(gone.fields)
  })

  it('cleans a component that holds one value, not a list', () => {
    const hero: BuilderBlock = {
      key: 'h',
      id: 2,
      component: 'section.hero',
      fields: { cta: { id: 6, label: 'Go' } },
    }
    const withCta: ComponentSchemas = {
      'section.hero': {
        uid: 'section.hero',
        attributes: { cta: { type: 'component', component: 'shared.link' } },
      },
    }
    expect(forgetUnknownIds([hero], new Set(), withCta)[0]!.fields).toEqual({
      cta: { label: 'Go' },
    })
  })

  it('leaves the ids alone when it has no schema for the component', () => {
    const odd: BuilderBlock = {
      key: 'o',
      id: 1,
      component: 'section.odd',
      fields: { items: [{ id: 2 }] },
    }
    expect(forgetUnknownIds([odd], new Set(), schemas)[0]!.fields).toEqual({ items: [{ id: 2 }] })
  })
})

describe('the undo history', () => {
  it('goes back one step at a time, keeping the keys of the blocks', () => {
    const one = [block('a')]
    const two = [block('a'), block('b')]
    let history = remember(EMPTY_HISTORY, one)
    history = remember(history, two)
    const first = undo(history)!
    expect(first.blocks).toBe(two)
    const second = undo(first.history)!
    expect(second.blocks).toBe(one)
    expect(keys(second.blocks)).toEqual(['a'])
    expect(undo(second.history)).toBeUndefined()
  })

  it('does not stack the same page twice and keeps a bounded history', () => {
    const page = [block('a')]
    const once = remember(EMPTY_HISTORY, page)
    expect(remember(once, page)).toBe(once)
    let history = EMPTY_HISTORY
    for (let step = 0; step < HISTORY_LIMIT + 10; step++)
      history = remember(history, [block(`k${step}`)])
    expect(history.past).toHaveLength(HISTORY_LIMIT)
    expect(history.past[HISTORY_LIMIT - 1]![0]!.key).toBe(`k${HISTORY_LIMIT + 9}`)
  })
})

describe('the refusal of a save', () => {
  it('reads the problem detail of a route with the site-scope middleware', () => {
    const error = {
      response: {
        data: {
          code: 'blockOptionInvalid',
          detail: 'The feature-grid block … columns',
          block: 'feature-grid',
        },
      },
    }
    expect(refusalOf(error)).toEqual({
      code: 'blockOptionInvalid',
      detail: 'The feature-grid block … columns',
      block: 'feature-grid',
    })
  })

  it('reads Strapi’s ValidationError of the Content Manager’s route, the code in error.details', () => {
    const error = {
      response: {
        data: {
          error: {
            name: 'ValidationError',
            message: 'The cta block is disabled on this site',
            details: { code: 'blockNotAllowed', block: 'cta', reason: 'disabled' },
          },
        },
      },
    }
    expect(refusalOf(error)).toEqual({
      code: 'blockNotAllowed',
      detail: 'The cta block is disabled on this site',
      block: 'cta',
    })
  })

  it('reads the refusal of a save over a draft someone else saved, by the code the server sends', () => {
    // The admin keeps its own copy of the code: it must be the server’s.
    expect(VERSION_CONFLICT).toBe(SERVER_CODE)
    const error = {
      response: {
        data: {
          error: {
            name: 'ValidationError',
            message: 'The document was saved by someone else after it was read',
            details: { code: SERVER_CODE },
          },
        },
      },
    }
    expect(refusalOf(error)?.code).toBe(VERSION_CONFLICT)
  })

  it('finds the block a refusal names: the one just added before an older one of its kind', () => {
    const stored: BuilderBlock = { key: 'a', id: 4, component: 'section.logo-cloud', fields: {} }
    const added: BuilderBlock = { key: 'b', component: 'section.logo-cloud', fields: {} }
    const other: BuilderBlock = { key: 'c', id: 5, component: 'section.rich-text', fields: {} }
    const entryOf = (block: BuilderBlock) => ({ id: block.component.replace('section.', '') })
    expect(refusedBlockOf([stored, other, added], 'logo-cloud', entryOf)).toBe(added)
    expect(refusedBlockOf([stored, other], 'logo-cloud', entryOf)).toBe(stored)
    expect(refusedBlockOf([stored], 'hero', entryOf)).toBeUndefined()
    expect(refusedBlockOf([stored], undefined, entryOf)).toBeUndefined()
  })

  it('answers nothing for an error that carries neither', () => {
    expect(refusalOf(new Error('network'))).toBeUndefined()
    expect(refusalOf({ response: { data: 'text' } })).toBeUndefined()
    expect(refusalOf(null)).toBeUndefined()
  })
})
