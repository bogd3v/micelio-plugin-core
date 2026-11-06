import { describe, expect, it } from 'vitest'
import {
  costKbOf,
  findSampleText,
  optionsSummary,
  parseTemplateDocument,
  samplesOf,
  shapeContent,
  slugOf,
  thumbnailOf,
  type AttributesOf,
} from '../server/src/page-templates/rules'
import type { TemplateBlock } from '../server/src/types/page-templates'

// The components of a page, as Strapi describes them: what a template reads of each.
const COMPONENTS: Record<string, Record<string, object>> = {
  'section.hero': {
    title: { type: 'string' },
    text: { type: 'text' },
    variant: { type: 'enumeration' },
    layout: { type: 'enumeration' },
    width: { type: 'enumeration' },
    primaryLink: { type: 'component', component: 'section.link', repeatable: false },
    media: { type: 'media' },
  },
  'section.feature-grid': {
    title: { type: 'string' },
    columns: { type: 'enumeration' },
    items: { type: 'component', component: 'section.feature-item', repeatable: true },
  },
  'section.feature-item': {
    title: { type: 'string' },
    text: { type: 'text' },
    icon: { type: 'media' },
    url: { type: 'string' },
  },
  'section.link': { label: { type: 'string' }, url: { type: 'string' } },
  'section.rich-text': { body: { type: 'richtext' } },
}
const attributesOf: AttributesOf = (component) => COMPONENTS[component] as never

describe('what a template keeps of a block', () => {
  const stored = {
    id: 7,
    __component: 'section.hero',
    title: 'Software you can read',
    text: '  ',
    variant: 'split',
    layout: 'centered',
    width: 'prose',
    primaryLink: { label: 'Start', url: '/start' },
    media: { id: 3, url: '/uploads/a.png' },
    other: 'not an attribute',
  }

  it('keeps the options and the text, and never a file, a link or an id', () => {
    expect(shapeContent(attributesOf, 'section.hero', stored, 'sample')).toEqual({
      title: 'Software you can read',
      variant: 'split',
      layout: 'centered',
    })
  })

  it('keeps no text of a cleared block, and its options', () => {
    expect(shapeContent(attributesOf, 'section.hero', stored, 'clear')).toEqual({
      variant: 'split',
      layout: 'centered',
    })
  })

  it('leaves out an option the block does not expose, though its component declares it', () => {
    expect(shapeContent(attributesOf, 'section.hero', stored, 'sample')).not.toHaveProperty('width')
    // The rich text does expose `width`; a component that has none keeps nothing of it.
    expect(
      shapeContent(attributesOf, 'section.rich-text', { body: 'Text', width: 'wide' }, 'sample')
    ).toEqual({ body: 'Text' })
  })

  it('keeps the items, with their text when kept and empty when cleared, and no address', () => {
    const grid = {
      title: 'Why',
      columns: '3',
      items: [
        { id: 1, title: 'Fast', text: 'Static.', url: 'https://example.test', icon: { id: 4 } },
        { id: 2, title: 'Open' },
      ],
    }
    expect(shapeContent(attributesOf, 'section.feature-grid', grid, 'sample')).toEqual({
      title: 'Why',
      columns: '3',
      items: [{ title: 'Fast', text: 'Static.' }, { title: 'Open' }],
    })
    expect(shapeContent(attributesOf, 'section.feature-grid', grid, 'clear')).toEqual({
      columns: '3',
      items: [{}, {}],
    })
  })

  it('is applied to its own result without changing it', () => {
    const once = shapeContent(
      attributesOf,
      'section.feature-grid',
      {
        title: 'Why',
        columns: '3',
        items: [{ title: 'Fast', text: 'Static.', url: '/x' }],
      },
      'sample'
    )
    expect(shapeContent(attributesOf, 'section.feature-grid', once, 'sample')).toEqual(once)
  })
})

describe('the sample texts of a page', () => {
  const block = (content: 'sample' | 'clear', data: object): TemplateBlock => ({
    block: 'feature-grid',
    component: 'section.feature-grid',
    content,
    fixed: false,
    data: data as Record<string, unknown>,
  })

  it('are the texts of the blocks that kept them, items included, once each', () => {
    const blocks = [
      block('sample', { title: 'Why', items: [{ title: 'Fast', text: 'Why' }, { title: 'Open' }] }),
      block('clear', { title: 'Ignored' }),
    ]
    expect(samplesOf(attributesOf, blocks)).toEqual(['Why', 'Fast', 'Open'])
  })

  it('are found where a draft still holds them, naming the block, its place and the field', () => {
    const zone = [
      { __component: 'section.hero', title: 'Own title', text: 'Sample' },
      {
        __component: 'section.feature-grid',
        title: ' Why ',
        items: [{ title: 'Mine', text: 'Fast' }],
      },
      { __component: 'host.custom', title: 'Why' },
    ]
    expect(findSampleText(attributesOf, zone, ['Why', 'Fast', 'Sample'])).toEqual([
      { block: 'hero', position: 0, fields: ['text'] },
      { block: 'feature-grid', position: 1, fields: ['title', 'items[1].text'] },
    ])
  })

  it('are found nowhere once every text is replaced, or when the page recorded none', () => {
    const zone = [{ __component: 'section.hero', title: 'Own title' }]
    expect(findSampleText(attributesOf, zone, ['Sample'])).toEqual([])
    expect(findSampleText(attributesOf, [{ __component: 'section.hero', title: 'x' }], [])).toEqual(
      []
    )
  })
})

describe('what a template weighs and looks like', () => {
  it('adds the cost of its blocks in kB with one decimal', () => {
    // hero 737 + 1556, feature-grid 643 + 1350 bytes: 4286 bytes.
    expect(costKbOf([{ block: 'hero' }, { block: 'feature-grid' }])).toBe(4.2)
    expect(costKbOf([])).toBe(0)
  })

  it('draws one shape for each block, and text for a block it has no shape for', () => {
    expect(
      thumbnailOf([{ block: 'hero' }, { block: 'feature-grid' }, { block: 'rich-text' }])
    ).toEqual(['hero', 'cards', 'text'])
  })

  it('lists the options of a block by name, and nothing else', () => {
    const hero: TemplateBlock = {
      block: 'hero',
      component: 'section.hero',
      content: 'sample',
      fixed: false,
      data: { title: 'Kept', variant: 'split', layout: 'centered', stray: 'x' },
    }
    expect(optionsSummary(hero)).toEqual({ variant: 'split', layout: 'centered' })
  })

  it('makes a slug of a title', () => {
    expect(slugOf('Open source, explained!')).toBe('open-source-explained')
    expect(slugOf('Árbol de la vida')).toBe('arbol-de-la-vida')
    expect(slugOf('  ***  ')).toBe('page')
  })
})

describe('reading the JSON of a template', () => {
  const valid = {
    format: 1,
    name: ' Explainer ',
    description: 'A grid.',
    pageTypes: ['landing'],
    scope: 'site',
    origin: 'site',
    version: 3,
    blocks: [
      {
        block: 'hero',
        component: 'host.anything',
        content: 'sample',
        fixed: true,
        data: { title: 'Kept', variant: 'split', media: { id: 1 } },
      },
    ],
  }

  it('reads a template, takes the component from the catalogue and shapes what a block holds', () => {
    expect(parseTemplateDocument(valid, attributesOf, 1)).toEqual({
      ...valid,
      name: 'Explainer',
      blocks: [
        {
          block: 'hero',
          component: 'section.hero',
          content: 'sample',
          fixed: true,
          data: { title: 'Kept', variant: 'split' },
        },
      ],
    })
  })

  it.each([
    ['a body that is no object', 'a string', 'body'],
    ['another format', { ...valid, format: 2 }, 'format'],
    ['a missing name', { ...valid, name: ' ' }, 'name'],
    ['a name that is too long', { ...valid, name: 'x'.repeat(81) }, 'name'],
    ['a description that is not text', { ...valid, description: 4 }, 'description'],
    ['page types that are not a list of texts', { ...valid, pageTypes: [1] }, 'pageTypes'],
    ['a scope that is neither', { ...valid, scope: 'world' }, 'scope'],
    ['an origin that is not the site', { ...valid, origin: 'theme' }, 'origin'],
    ['a version that is not whole', { ...valid, version: 1.5 }, 'version'],
    ['no block', { ...valid, blocks: [] }, 'blocks'],
    [
      'a block the catalogue lacks',
      { ...valid, blocks: [{ ...valid.blocks[0], block: 'nope' }] },
      'blocks',
    ],
    [
      'a block that keeps neither',
      { ...valid, blocks: [{ ...valid.blocks[0], content: 'all' }] },
      'blocks',
    ],
    [
      'a block with no fixed flag',
      { ...valid, blocks: [{ ...valid.blocks[0], fixed: 'yes' }] },
      'blocks',
    ],
  ])('refuses %s', (_name, document, field) => {
    expect(parseTemplateDocument(document, attributesOf, 1)).toMatchObject({ field })
  })
})
