import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { BLOCKS, blockContentSchema, type Block } from '../contract/blocks'
import { strapiComponents, type StrapiAttributes } from '../contract/strapi'
import fixture from './fixtures/micelio-cms-v0.4.0-components.json'

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
  ['post-list', 'section.post-list', ['cards', 'list']],
  ['newsletter', 'section.newsletter', ['inline', 'card']],
  ['rich-text', 'section.rich-text', []],
  ['gallery', 'section.gallery', ['grid', 'masonry']],
  ['scene', 'section.scene', ['background', 'inline']],
  ['prose', 'shared.rich-text', []],
  ['quote', 'shared.quote', []],
  ['media', 'shared.media', []],
  ['slider', 'shared.slider', []],
  ['playground', 'shared.playground', []],
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
  group: z.enum(['section', 'article']),
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
  it('has exactly the 19 blocks of ADR-0018, section 6, in its order', () => {
    expect(BLOCKS.map((block) => [block.id, block.schema.component])).toEqual(
      CATALOGUE.map(([id, component]) => [id, component])
    )
  })

  it.each(BLOCKS.map((block) => [block.id, block] as const))('%s is a valid entry', (_, block) => {
    expect(ENTRY.safeParse(block).error?.issues ?? []).toEqual([])
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
    '%s matches %s of micelio-cms v0.4.0, with every part it nests',
    (id, component) => {
      const described = strapiComponents(blockOf(id)).components
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

  it('accounts for the 32 components of the fixture', () => {
    const described = new Set(
      BLOCKS.flatMap((block) => Object.keys(strapiComponents(block).components))
    )
    expect(Object.keys(components)).toHaveLength(32)
    expect(
      Object.keys(components)
        .filter((uid) => !described.has(uid))
        .sort()
    ).toEqual([...FIELDS].sort())
  })

  it('declares an island for scene and playground only, with their registry id and budget', () => {
    const islands = BLOCKS.filter((block) => block.cost.island)
    expect(Object.fromEntries(islands.map((block) => [block.id, pick(block)]))).toEqual(ISLANDS)
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
