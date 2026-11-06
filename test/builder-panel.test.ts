import { describe, expect, it } from 'vitest'
import {
  fieldsOf,
  filesOf,
  isIncomplete,
  itemsOf,
  missingRequired,
  startingFields,
} from '../admin/src/utils/builder/fields'
import {
  GAP_HEIGHT,
  gapsOf,
  nearestGap,
  reportedAt,
  toRect,
} from '../admin/src/utils/builder/geometry'
import { gapMessage, patchMessage, selectMessage } from '../admin/src/utils/builder/messages'
import {
  costKbOf,
  groupRows,
  highlight,
  matches,
  nameOf,
  pushRecent,
  stateOf,
  type CatalogueEntry,
  type PaletteRow,
} from '../admin/src/utils/builder/palette'
import { parsePreviewMessage } from '../contract/preview'

const grid = {
  uid: 'section.feature-grid',
  attributes: {
    title: { type: 'string' },
    text: { type: 'text', required: true },
    columns: { type: 'enumeration', enum: ['2', '3', '4', '6'] },
    width: { type: 'enumeration', enum: ['prose', 'wide'] },
    cover: { type: 'media' },
    items: { type: 'component', repeatable: true, component: 'section.feature-item' },
  },
}

describe('the fields of the panel', () => {
  it('sorts a component into options, text and items, offering only what the host stores', () => {
    const fields = fieldsOf(grid, { columns: ['2', '3', '4'], tone: ['default'] })
    // `6` is not in the contract’s set for this site; `width` is not exposed; `tone` is not in the host.
    expect(fields.options).toEqual([{ name: 'columns', values: ['2', '3', '4'] }])
    expect(fields.text).toEqual([
      { name: 'title', multiline: false, required: false },
      { name: 'text', multiline: true, required: true },
    ])
    expect(fields.items).toEqual([
      { name: 'items', component: 'section.feature-item', required: false },
    ])
    // A value of the contract that the host's enumeration lacks is not offered either.
    expect(fieldsOf(grid, { width: ['prose', 'wide', 'full'] }).options).toEqual([
      { name: 'width', values: ['prose', 'wide'] },
    ])
    expect(fieldsOf(undefined, {})).toEqual({ options: [], text: [], items: [] })
  })

  it('names the required text a block lacks, blank text included', () => {
    const fields = fieldsOf(grid, {})
    expect(missingRequired(fields, { title: '', text: '  ' })).toEqual(['text'])
    expect(missingRequired(fields, { text: 'Hello' })).toEqual([])
  })

  it('names a required list of items that has none, and an item that lacks its required text', () => {
    const required = {
      uid: 'section.faq',
      attributes: {
        items: { type: 'component', repeatable: true, component: 'x', required: true },
      },
    }
    const fields = fieldsOf(required, {})
    expect(missingRequired(fields, {})).toEqual(['items'])
    expect(missingRequired(fields, { items: [{ q: 'a' }] })).toEqual([])
    const inner = fieldsOf({ uid: 'x', attributes: { q: { type: 'string', required: true } } }, {})
    // The block is complete only when every item has its own required text too.
    expect(isIncomplete(fields, { items: inner }, { items: [{ q: '' }] })).toBe(true)
    expect(isIncomplete(fields, { items: inner }, { items: [{ q: 'Why?' }] })).toBe(false)
    expect(isIncomplete(fields, { items: inner }, {})).toBe(true)
  })

  it('starts a block with the site’s default of each option the host stores', () => {
    expect(startingFields(grid, { columns: '4', width: 'wide', tone: 'accent' })).toEqual({
      columns: '4',
      width: 'wide',
    })
    // A default the host’s enumeration lacks is not written.
    expect(startingFields(grid, { columns: '9' })).toEqual({})
  })

  it('lists the items of a field and tolerates anything else', () => {
    expect(itemsOf({ items: [{ title: 'a' }, 1, null] }, 'items')).toEqual([{ title: 'a' }])
    expect(itemsOf({}, 'items')).toEqual([])
  })
})

const entry = (id: string, over: Partial<CatalogueEntry> = {}): CatalogueEntry => ({
  id,
  group: 'section',
  component: `section.${id}`,
  options: {},
  label: {},
  pageTypes: ['standard', 'landing'],
  cost: { css: 1024, js: 1024, island: null },
  ...over,
})
const row = (e: CatalogueEntry, state: PaletteRow['state'] = 'ok'): PaletteRow => ({
  entry: e,
  name: nameOf(e, 'en'),
  costKb: costKbOf(e),
  isIsland: e.cost.island !== null,
  state,
})

describe('the palette', () => {
  it('names a block by the site’s label in the editor’s language, else its id made readable', () => {
    expect(nameOf(entry('feature-grid'), 'en')).toBe('Feature grid')
    expect(nameOf(entry('hero', { label: { es: 'Portada' } }), 'es-ES')).toBe('Portada')
    expect(nameOf(entry('hero', { label: { en: 'Hero' } }), 'es')).toBe('Hero')
  })

  it('weighs a block in kB with one decimal, an island’s on-demand script apart', () => {
    expect(costKbOf(entry('a', { cost: { css: 737, js: 1556, island: null } }))).toBe(2.2)
    expect(costKbOf(entry('b', { cost: { css: 0, js: 0, island: { js: 99999 } } }))).toBe(0)
  })

  it('refuses a block the page type’s catalogue excludes and flags one over the remaining budget', () => {
    const landing = entry('hero', { pageTypes: ['landing'] })
    expect(stateOf(landing, 'standard', 100)).toBe('notAllowed')
    expect(stateOf(landing, 'landing', 100)).toBe('ok')
    expect(stateOf(landing, 'landing', 1.9)).toBe('overBudget')
    expect(stateOf(landing, 'landing', 2)).toBe('ok')
    expect(stateOf(landing, 'landing', undefined)).toBe('ok')
  })

  it('searches by name or id and sets the match in bold', () => {
    const gallery = row(entry('gallery'))
    expect(matches(gallery, 'GAL')).toBe(true)
    expect(matches(gallery, 'carousel')).toBe(false)
    expect(matches(gallery, '  ')).toBe(true)
    expect(highlight('Gallery', 'gal')).toEqual({ before: '', match: 'Gal', after: 'lery' })
    expect(highlight('Gallery', 'zzz')).toEqual({ before: 'Gallery', match: '', after: '' })
  })

  it('groups recently used first, then the catalogue’s groups; a search is one group of results', () => {
    const rows = [
      row(entry('hero')),
      row(entry('quote', { group: 'article' })),
      row(entry('gallery')),
    ]
    expect(
      groupRows(rows, '', ['gallery']).map((g) => [g.id, g.rows.map((r) => r.entry.id)])
    ).toEqual([
      ['recent', ['gallery']],
      ['section', ['hero', 'gallery']],
      ['article', ['quote']],
    ])
    expect(groupRows(rows, 'gal', ['gallery']).map((g) => [g.id, g.rows.length])).toEqual([
      ['results', 1],
    ])
    expect(groupRows(rows, 'carousel', [])[0]!.rows).toEqual([])
    // A block that costs more than what is left leaves its group for one of its own, listed last.
    const heavy = [
      row(entry('hero')),
      row(entry('scene'), 'overBudget'),
      row(entry('quote', { group: 'article' })),
    ]
    expect(groupRows(heavy, '', []).map((g) => [g.id, g.rows.map((r) => r.entry.id)])).toEqual([
      ['section', ['hero']],
      ['article', ['quote']],
      ['overBudget', ['scene']],
    ])
    // A search keeps it among the results, with its note.
    expect(groupRows(heavy, 'scene', [])[0]!.rows.map((r) => r.entry.id)).toEqual(['scene'])
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    expect(pushRecent(['a', 'b', 'c'], 'd')).toEqual(['d', 'a', 'b'])
  })
})

const report = {
  version: 'v1',
  scroll: { x: 0, y: 100 },
  viewport: { width: 1000, height: 800 },
  blocks: [
    {
      address: { zone: 'sections' as const, index: 0, block: 'hero', version: 'v1' },
      box: { x: 0, y: 100, width: 1000, height: 200 },
      items: [],
    },
    {
      address: { zone: 'sections' as const, index: 1, block: 'cta', version: 'v1' },
      box: { x: 0, y: 300, width: 1000, height: 150 },
      items: [],
    },
  ],
}

describe('the overlay’s geometry', () => {
  it('turns a box of the document into a rectangle of the window, scroll taken off', () => {
    expect(toRect({ x: 10, y: 300, width: 5, height: 6 }, { x: 4, y: 100 })).toEqual({
      top: 200,
      left: 6,
      width: 5,
      height: 6,
    })
  })

  it('has one gap above the first block and one under each, on the boundary', () => {
    const gaps = gapsOf(report)
    expect(gaps.map((g) => [g.after, g.position])).toEqual([
      [null, 0],
      [0, 1],
      [1, 2],
    ])
    // The line is centred on the boundary: the top of the page, then the bottom of each block.
    expect(gaps.map((g) => g.rect.top + GAP_HEIGHT / 2)).toEqual([0, 200, 350])
    expect(gapsOf({ ...report, blocks: [] })).toEqual([])
  })

  it('finds the gap nearest to the pointer', () => {
    const gaps = gapsOf(report)
    expect(nearestGap(gaps, 190)?.position).toBe(1)
    expect(nearestGap(gaps, 9999)?.position).toBe(2)
    expect(nearestGap([], 10)).toBeUndefined()
    expect(reportedAt(report, 1)?.address.block).toBe('cta')
    expect(reportedAt(undefined, 0)).toBeUndefined()
  })
})

describe('the messages the builder sends', () => {
  const address = { zone: 'sections' as const, index: 1, block: 'cta', version: 'v1' }

  it('are messages of the contract, in the envelope of version 1', () => {
    const messages = [
      selectMessage(address, null, true),
      selectMessage(null, null, false),
      gapMessage('v1', null, 120),
      patchMessage(address, { title: 'New' }, [{ index: 0, content: { text: null } }]),
    ]
    for (const message of messages) expect(parsePreviewMessage(message)).toEqual(message)
    expect(messages.map((m) => m.v)).toEqual([1, 1, 1, 1])
  })
})

describe('the media fields of the panel', () => {
  const gallery = {
    uid: 'section.gallery',
    attributes: {
      title: { type: 'string' },
      images: { type: 'media', multiple: true, allowedTypes: ['images'], required: true },
      cover: { type: 'media', multiple: false },
    },
  }
  const image = { id: 4, name: 'a.png', mime: 'image/png', size: 1.2, alternativeText: null }

  it('lists the media of a component with what the Media Library dialog needs', () => {
    expect(fieldsOf(gallery, {}).media).toEqual([
      { name: 'images', multiple: true, allowedTypes: ['images'], required: true },
      { name: 'cover', multiple: false, allowedTypes: [], required: false },
    ])
  })

  it('reads the files of a single or a multiple field and skips what is not a file', () => {
    expect(filesOf({ images: [image, null, 3] }, 'images')).toEqual([image])
    expect(filesOf({ cover: image }, 'cover')).toEqual([image])
    expect(filesOf({ cover: null }, 'cover')).toEqual([])
    expect(filesOf({}, 'images')).toEqual([])
  })

  it('counts a required media field with no file as missing, which holds the save', () => {
    const fields = fieldsOf(gallery, {})
    expect(missingRequired(fields, { images: [] })).toEqual(['images'])
    expect(missingRequired(fields, { images: null })).toEqual(['images'])
    expect(missingRequired(fields, { images: [image] })).toEqual([])
    // An optional one never does.
    expect(missingRequired(fields, { images: [image], cover: null })).toEqual([])
    expect(isIncomplete(fields, {}, { images: [] })).toBe(true)
    expect(isIncomplete(fields, {}, { images: [image] })).toBe(false)
  })

  it('counts an item’s required media in the page’s check', () => {
    const outer = fieldsOf(grid, {})
    const inner = fieldsOf(
      { uid: 'section.feature-item', attributes: { icon: { type: 'media', required: true } } },
      {}
    )
    const items = (icon: unknown) => ({ text: 'x', items: [{ icon }] })
    expect(isIncomplete(outer, { items: inner }, items(null))).toBe(true)
    expect(isIncomplete(outer, { items: inner }, items(image))).toBe(false)
  })
})
