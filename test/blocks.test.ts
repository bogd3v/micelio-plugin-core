import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  BLOCKS,
  ISLAND_KINDS,
  SITE_MODULES,
  blockContentSchema,
  optionsOf,
  type Block,
} from '../contract/blocks'
import { ICON_KEYWORD, component, icon, iconFields, part, string, text } from '../contract/fields'
import { OPTION_NAMES } from '../contract/options'
import { OPTIONS } from '../contract/options'
import { strapiComponents, type StrapiAttributes } from '../contract/strapi'
import { blockJsonSchema, iconFieldsOf, iconIssues, type JsonSchema } from '../contract/strapi'
import { costBytes } from '../contract/blocks'
import modulesComponent from '../server/src/components/site/modules.json'
import fixture from './fixtures/micelio-cms-components-with-ids.json'

// The first catalogue, as ADR-0018, section 6, lists it: id, component and `variant`, default first.
const CATALOGUE: [string, string, string[]][] = [
  ['hero', 'section.hero', ['centered', 'split', 'full-bleed']],
  ['feature-grid', 'section.feature-grid', ['grid', 'list', 'bento']],
  ['media-showcase', 'section.media-showcase', ['left', 'right', 'stacked']],
  ['stats', 'section.stats', ['row', 'cards']],
  ['logo-cloud', 'section.logo-cloud', ['row', 'marquee']],
  ['testimonials', 'section.testimonials', ['single', 'grid']],
  ['pricing', 'section.pricing', ['cards', 'table']],
  ['faq', 'section.faq', ['list', 'two-columns']],
  ['cta', 'section.cta', ['banner', 'card']],
  ['post-list', 'section.post-list', ['cards', 'list', 'featured']],
  ['newsletter', 'section.newsletter', ['inline', 'card']],
  ['gallery', 'section.gallery', ['grid', 'masonry']],
  ['scene', 'section.scene', ['background', 'inline']],
  ['prose', 'shared.rich-text', []],
  ['quote', 'shared.quote', []],
  ['media', 'shared.media', []],
  ['slider', 'shared.slider', []],
  ['playground', 'shared.playground', []],
  // micelio-cms#448: code with a file name, highlighted lines and a caption.
  ['code', 'shared.code', []],
  // ADR-0022, section 1: a reference to a reusable block.
  ['reusable', 'section.reusable', []],
]

// "Parts and fields": each part and the blocks it is nested in. `section.link` reaches `pricing`
// through `section.plan`; `shared.image-credit` reaches `slider` through `shared.slide`.
const PARTS: Record<string, string[]> = {
  'section.link': ['hero', 'media-showcase', 'cta', 'pricing'],
  'section.feature-item': ['feature-grid'],
  'section.faq-item': ['faq'],
  'section.logo': ['logo-cloud'],
  'section.plan': ['pricing'],
  'section.stat': ['stats'],
  'section.testimonial': ['testimonials'],
  'shared.slide': ['slider'],
  'shared.image-credit': ['media', 'slider'],
}

// Fields of a content type, not of a block: they are in no block's schema.
const FIELDS = ['shared.seo', 'shared.meta-social', 'shared.reference', 'shared.tech-item']

const ISLANDS: Record<string, { id: string; budget: string }> = {
  scene: { id: 'scene', budget: 'scene' },
  playground: { id: 'playground', budget: 'playground' },
}

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const BYTES = z.int().positive()

// The shape of an entry (ADR-0018, section 1), beyond what its TypeScript type says.
const ENTRY = z.object({
  id: z.string().regex(KEBAB_CASE),
  group: z.enum(['section', 'article', 'both']),
  options: z.object({
    variant: z
      .object({ values: z.array(z.string().regex(KEBAB_CASE)).min(2), default: z.string() })
      .refine((variant) => variant.default === variant.values[0], 'the default goes first')
      .optional(),
  }),
  cost: z.object({
    css: BYTES,
    js: BYTES,
    island: z.object({ id: z.string(), budget: z.string(), js: BYTES }).nullable(),
  }),
  static: z.string().trim().min(1),
})

const components = fixture.components as Record<string, { attributes: StrapiAttributes }>

describe('the block catalogue', () => {
  it('has exactly the 20 blocks of the catalogue (ADR-0018, section 6, less `rich-text`, and `reusable` of ADR-0022 and `code`), in its order', () => {
    expect(BLOCKS.map((block) => [block.id, block.schema.component])).toEqual(
      CATALOGUE.map(([id, component]) => [id, component])
    )
  })

  it.each(BLOCKS.map((block) => [block.id, block] as const))('%s is a valid entry', (_, block) => {
    expect(ENTRY.safeParse(block).error?.issues ?? []).toEqual([])
  })

  it("a block entry's module is a key of site.modules, and newsletter declares newsletter", () => {
    const keys = Object.keys(modulesComponent.attributes)
    expect([...SITE_MODULES].toSorted()).toEqual(keys.toSorted())
    for (const block of BLOCKS) {
      if (block.module !== undefined) expect(keys).toContain(block.module)
    }
    expect(blockOf('newsletter').module).toBe('newsletter')
    expect(BLOCKS.filter((block) => block.module).map((block) => block.id)).toEqual(['newsletter'])
  })

  it("every page section offers tone and align with the vocabulary's defaults", () => {
    // `reusable` has no presentation options of its own (ADR-0022, section 1).
    const sections = BLOCKS.filter((block) => block.group === 'section' && block.id !== 'reusable')
    expect(sections.map((block) => block.id)).toEqual(CATALOGUE.slice(0, 13).map(([id]) => id))
    for (const block of sections) {
      expect(block.options.tone, `${block.id}.tone`).toEqual({
        values: ['default', 'raised', 'accent'],
        default: 'default',
      })
      expect(block.options.align, `${block.id}.align`).toEqual({
        values: ['start', 'center'],
        default: 'start',
      })
    }
  })

  it.each(CATALOGUE)('%s offers the variants of the ADR, default first', (id, _, variants) => {
    const variant = blockOf(id).options.variant
    expect(variant?.values ?? []).toEqual(variants)
    expect(variant?.default).toBe(variants[0])
  })

  it.each(CATALOGUE)('%s offers the variants of its component in micelio-cms', (id, component) => {
    const stored = components[component]?.attributes.variant
    const variant = blockOf(id).options.variant
    expect(variant?.values).toEqual(stored?.enum)
    expect(variant?.default).toBe(stored?.default)
  })

  it.each(CATALOGUE)('%s keeps variant out of its schema', (id) => {
    expect(Object.keys(blockOf(id).schema.fields.shape)).not.toContain('variant')
  })

  it.each(CATALOGUE)(
    '%s matches %s of the micelio-cms components fixture, with every part it nests',
    (id, component) => {
      const described = withoutVocabulary(strapiComponents(blockOf(id)).components, component)
      expect(described[component]).toBeDefined()
      for (const [uid, attributes] of Object.entries(described)) {
        expect(components[uid], `${uid} is in the fixture`).toBeDefined()
        expect(normalized(attributes), uid).toEqual(normalized(components[uid].attributes))
      }
    }
  )

  it.each(Object.entries(PARTS))('nests %s in the blocks the ADR names', (uid, ids) => {
    const nesting = BLOCKS.filter((block) => uid in strapiComponents(block).components)
    expect(nesting.map((block) => block.id).sort()).toEqual([...ids].sort())
  })

  it('makes no entry of a part or a field', () => {
    const entries = BLOCKS.map((block) => block.schema.component)
    for (const uid of [...Object.keys(PARTS), ...FIELDS]) expect(entries).not.toContain(uid)
    for (const block of BLOCKS) {
      for (const uid of FIELDS)
        expect(Object.keys(strapiComponents(block).components)).not.toContain(uid)
    }
  })

  // `section.rich-text` is left out with its block; it stays a component of the host until it is retired.
  it('accounts for the 35 components of the fixture', () => {
    const described = new Set(
      BLOCKS.flatMap((block) => Object.keys(strapiComponents(block).components))
    )
    expect(Object.keys(components)).toHaveLength(35)
    expect(
      Object.keys(components)
        .filter((uid) => !described.has(uid))
        .sort()
    ).toEqual([...FIELDS, 'section.rich-text'].sort())
  })

  it('the reusable block has one relation and no presentation options', () => {
    const reusable = blockOf('reusable')
    expect(reusable.group).toBe('section')
    expect(reusable.options).toEqual({})
    expect(optionsOf(reusable)).toEqual([])
    const attributes = strapiComponents(reusable).components['section.reusable']
    const relations = Object.entries(attributes).filter(([, field]) => field.type === 'relation')
    expect(relations).toEqual([
      [
        'reusableBlock',
        { type: 'relation', relation: 'oneToOne', target: 'plugin::micelio.reusable-block' },
      ],
    ])
    // Its other fields are the instance id and the group key, as on every page section.
    expect(Object.keys(attributes).sort()).toEqual(['blockId', 'group', 'reusableBlock'])
    expect(reusable.cost.island).toBeNull()
  })

  it('gives every page section an optional group key with a required groupId and tone, and no default', () => {
    for (const block of BLOCKS) {
      const { component, components: own } = strapiComponents(block)
      if (block.group !== 'section') {
        expect(own[component].group, block.id).toBeUndefined()
        continue
      }
      expect(own[component].group, block.id).toEqual({
        type: 'component',
        repeatable: false,
        component: 'section.group',
      })
      expect(own['section.group'], block.id).toEqual({
        groupId: { type: 'string', required: true },
        tone: { type: 'enumeration', enum: [...OPTIONS.tone.values], required: true },
      })
    }
  })

  it('gives a faq item an optional defaultOpen that is false by default and no default to the options', () => {
    const faq = blockOf('faq')
    const item = strapiComponents(faq).components['section.faq-item']
    expect(item.defaultOpen).toEqual({ type: 'boolean', default: false })
    expect(item.defaultOpen.required).toBeUndefined()
    const schema = blockContentSchema(faq)
    const content = { variant: 'list', items: [{ question: 'q', answer: 'a' }] }
    expect(schema.safeParse(content).success).toBe(true)
    expect(
      schema.safeParse({ ...content, items: [{ question: 'q', answer: 'a', defaultOpen: true }] })
        .success
    ).toBe(true)
    expect(
      schema.safeParse({ ...content, items: [{ question: 'q', answer: 'a', defaultOpen: 'yes' }] })
        .success
    ).toBe(false)
  })

  it('has no entry for rich-text, and puts prose in both zones', () => {
    expect(BLOCKS.map((block) => block.id)).not.toContain('rich-text')
    expect(BLOCKS.map((block) => block.schema.component)).not.toContain('section.rich-text')
    expect(blockOf('prose')).toMatchObject({
      group: 'both',
      schema: { component: 'shared.rich-text' },
    })
  })

  it('declares an island for scene and playground only, with their registry id and budget', () => {
    const islands = BLOCKS.filter((block) => block.cost.island)
    expect(Object.fromEntries(islands.map((block) => [block.id, pick(block)]))).toEqual(ISLANDS)
  })

  it('gives each island a kind, a load weight and the fields of its static alternative', () => {
    const islands = BLOCKS.flatMap((block) =>
      block.cost.island ? [{ block, island: block.cost.island }] : []
    )
    expect(
      Object.fromEntries(
        islands.map(({ block, island }) => [
          block.id,
          { kind: island.kind, loadKb: island.loadKb, alternative: island.alternative },
        ])
      )
    ).toEqual({
      scene: { kind: '3d', loadKb: 151.3, alternative: ['poster', 'alt'] },
      playground: { kind: 'runtime', loadKb: 406.7, alternative: ['expectedOutput'] },
    })
    for (const { block, island } of islands) {
      expect(ISLAND_KINDS).toContain(island.kind)
      // The alternative is made of fields of the block's own schema.
      for (const field of island.alternative) {
        expect(block.schema.fields.shape).toHaveProperty(field)
      }
    }
  })

  it('validates content as the content API answers it', () => {
    const schema = blockContentSchema(blockOf('hero'))
    const content = {
      variant: 'split',
      title: 'Welcome',
      text: null,
      primaryLink: { label: 'Start', url: '/start' },
      secondaryLink: null,
      media: { url: '/uploads/a.png', mime: 'image/png', name: 'a.png' },
    }
    expect(schema.safeParse(content).success).toBe(true)
    expect(schema.safeParse({ ...content, title: undefined }).success).toBe(false)
    expect(schema.safeParse({ ...content, variant: 'diagonal' }).success).toBe(false)
    expect(
      schema.safeParse({ ...content, primaryLink: { label: 'x', url: 'javascript:x' } }).success
    ).toBe(false)
  })
})

// No entry has an icon field yet: each of the four step-1 fields lands with its block's line of the
// plan, so these cases build an entry of their own (ADR-0021, section 1).
describe('an icon field', () => {
  it('an icon field maps to the micelio.icon custom field and is optional unless declared required', () => {
    const entry = iconBlock({
      itemId: string(),
      icon: icon({ required: false }),
      title: string({ required: true }),
    })
    const item = strapiComponents(entry).components['section.icon-item']
    expect(item.icon).toEqual({ type: 'customField', customField: 'plugin::micelio.icon' })
    const schema = blockContentSchema(entry)
    const content = { variant: 'grid', items: [{ title: 'Fast' }] }
    expect(schema.safeParse(content).success).toBe(true)
    expect(schema.safeParse({ ...content, items: [{ title: 'Fast', icon: null }] }).success).toBe(
      true
    )
    expect(
      schema.safeParse({ ...content, items: [{ title: 'Fast', icon: 'map-pin' }] }).success
    ).toBe(true)
    expect(
      schema.safeParse({ ...content, items: [{ title: 'Fast', icon: '/uploads/a.svg' }] }).success
    ).toBe(false)

    const required = iconBlock({ icon: icon({ required: true }), title: string() })
    expect(strapiComponents(required).components['section.icon-item'].icon).toEqual({
      type: 'customField',
      customField: 'plugin::micelio.icon',
      required: true,
    })
    expect(
      blockContentSchema(required).safeParse({ variant: 'grid', items: [{ title: 'Fast' }] })
        .success
    ).toBe(false)
    expect(iconFieldsOf(required)).toEqual([
      { path: 'items[].icon', declaration: { required: true, alone: false } },
    ])
  })

  it('an icon that stands alone requires a label in the schema', () => {
    const alone = iconBlock({
      url: string({ required: true }),
      ...iconFields({ required: false, alone: true }),
    })
    const item = nonNull(blockJsonSchema(alone).properties?.items).items
    expect(item?.required).toContain('label')
    expect(item?.properties?.icon?.anyOf?.[0]?.[ICON_KEYWORD]).toEqual({
      required: false,
      alone: true,
    })
    expect(strapiComponents(alone).components['section.icon-item'].label).toEqual({
      type: 'string',
      required: true,
    })
    const schema = blockContentSchema(alone)
    const content = {
      variant: 'grid',
      items: [{ url: '/a', icon: 'brand-mastodon', label: 'Mastodon' }],
    }
    expect(schema.safeParse(content).success).toBe(true)
    expect(
      schema.safeParse({ ...content, items: [{ url: '/a', icon: 'brand-mastodon' }] }).success
    ).toBe(false)
    expect(iconIssues(alone)).toEqual([])

    // Decorative, beside text: no label is asked.
    const decorative = iconBlock({
      title: string({ required: true }),
      ...iconFields({ required: false }),
    })
    expect(Object.keys(decorative.schema.fields.shape)).not.toContain('label')
    expect(iconIssues(decorative)).toEqual([])

    // A part that makes the label of an icon that stands alone optional breaks the rule.
    const unnamed = iconBlock({ icon: icon({ required: false, alone: true }), label: string() })
    expect(iconIssues(unnamed)).toEqual([
      'icon-grid: the icon items[].icon stands alone and needs a required label beside it',
    ])
  })

  it('the generated schema describes an icon field with its iconStyle option', () => {
    const schema = blockJsonSchema(iconBlock({ title: text(), ...iconFields({ required: false }) }))
    expect(nonNull(schema.properties?.iconStyle)).toMatchObject({
      type: 'string',
      enum: ['outline', 'filled'],
      default: 'outline',
    })
    expect(schema.required ?? []).not.toContain('iconStyle')
    const field = nonNull(nonNull(schema.properties?.items).items?.properties?.icon)
    expect(field).toMatchObject({
      type: 'string',
      pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
      'x-strapi': { type: 'customField', customField: 'plugin::micelio.icon' },
      [ICON_KEYWORD]: { required: false, alone: false },
    })
    expect(field?.description).toContain('iconStyle')
  })

  it('a block with an icon field offers iconStyle and declares cost.icons, and no other block does', () => {
    for (const block of BLOCKS) expect(iconIssues(block), block.id).toEqual([])
    const fields = { title: string(), ...iconFields({ required: false }) }
    const withoutStyle = iconBlock(fields)
    delete withoutStyle.options.iconStyle
    expect(iconIssues(withoutStyle)).toEqual([
      'icon-grid: a block with an icon field offers iconStyle',
    ])
    const plain = iconBlock({ title: string() })
    expect(iconIssues(plain)).toEqual([
      'icon-grid: iconStyle is offered with no icon field',
      'icon-grid: cost.icons is declared with no icon field',
    ])
    const withoutCost = iconBlock(fields)
    delete withoutCost.cost.icons
    expect(iconIssues(withoutCost)).toEqual([
      'icon-grid: a block with an icon field declares cost.icons',
    ])
  })
})

describe('the cost of a block', () => {
  it("a block's cost total adds the bytes of its icons' sprite entries to its CSS and JS", () => {
    const withIcons = iconBlock({ title: string(), ...iconFields({ required: false }) })
    expect(costBytes(withIcons.cost)).toBe(1 + 1 + 97)
    for (const block of BLOCKS) {
      expect(costBytes(block.cost), block.id).toBe(block.cost.css + block.cost.js)
    }
  })
})

// An optional field is `anyOf: [field, { type: 'null' }]`.
function nonNull(schema: JsonSchema | undefined): JsonSchema {
  return schema?.anyOf?.find((option) => option.type !== 'null') ?? schema ?? {}
}

// An entry with one repeatable part, `section.icon-item`, of the given fields: test data, never a
// block of the catalogue.
function iconBlock(fields: Parameters<typeof part>[1]): Block {
  return {
    id: 'icon-grid',
    group: 'section',
    schema: part('section.icon-grid', {
      items: component(part('section.icon-item', fields), { repeatable: true }),
    }),
    options: {
      variant: { values: ['grid', 'list'], default: 'grid' },
      iconStyle: { values: OPTIONS.iconStyle.values, default: OPTIONS.iconStyle.default },
    },
    cost: { css: 1, js: 1, island: null, icons: 97 },
    static: 'Itself.',
  }
}

// The options of the vocabulary (contract/options.ts) are new in the catalogue: the components of
// micelio-cms v0.4.0 (the base of the fixture) have only `variant`, and micelio-cms adds the rest in its own change (standard,
// section 6: CMS first). test/block-options.test.ts covers them; everything else is compared as is.
function withoutVocabulary(
  components: Record<string, StrapiAttributes>,
  uid: string
): Record<string, StrapiAttributes> {
  const names = new Set<string>(OPTION_NAMES)
  return {
    ...components,
    [uid]: Object.fromEntries(Object.entries(components[uid]).filter(([name]) => !names.has(name))),
  }
}

function blockOf(id: string): Block {
  const block = BLOCKS.find((entry) => entry.id === id)
  if (!block) throw new Error(`no block ${id}`)
  return block
}

function pick(block: Block): { id: string; budget: string } | undefined {
  return block.cost.island
    ? { id: block.cost.island.id, budget: block.cost.island.budget }
    : undefined
}

// Strapi's defaults left out (`required: false`), and a pattern compared as a regular expression:
// JSON Schema keeps it as `RegExp#source`, which escapes `/`.
function normalized(attributes: StrapiAttributes): StrapiAttributes {
  return Object.fromEntries(
    Object.entries(attributes).map(([name, { required, regex, ...attribute }]) => [
      name,
      {
        ...attribute,
        ...(required === true && { required }),
        ...(typeof regex === 'string' && { regex: new RegExp(regex).source }),
      },
    ])
  )
}
