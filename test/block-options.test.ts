import { describe, expect, it } from 'vitest'
import { BLOCKS, blockContentSchema, optionsOf, type Block } from '../contract/blocks'
import catalogueSchema from '../contract/blocks.schema.json'
import { OPTIONS, OPTION_NAMES, valuesFor, type OptionName } from '../contract/options'
import { findBlockOptionViolation } from '../server/src/block-options/rules'
import { catalogueFingerprint, diffFingerprints } from '../server/src/utils/block-catalogue'

const featureGrid = block('feature-grid')

function block(id: string): Block {
  const found = BLOCKS.find((entry) => entry.id === id)
  if (!found) throw new Error(`no block ${id}`)
  return found
}

describe('the options vocabulary', () => {
  it('has the eight names of the artboard, and no others', () => {
    expect([...OPTION_NAMES]).toEqual([
      'layout',
      'width',
      'columns',
      'density',
      'align',
      'tone',
      'ratio',
      'height',
    ])
  })

  it('has the values of the artboard, in its order, with the pressed one as the default', () => {
    expect(
      Object.fromEntries(Object.entries(OPTIONS).map(([name, o]) => [name, [o.values, o.default]]))
    ).toEqual({
      layout: [['centered', 'split', 'stacked'], 'centered'],
      width: [['prose', 'wide', 'full'], 'prose'],
      columns: [['2', '3', '4', '6'], '3'],
      density: [['comfortable', 'compact'], 'comfortable'],
      align: [['start', 'center'], 'start'],
      tone: [['default', 'raised', 'accent'], 'default'],
      ratio: [['16:9', '4:3', '1:1', 'auto'], '16:9'],
      height: [['s', 'm', 'l', 'full'], 'm'],
    })
  })

  it.each(Object.entries(OPTIONS))('%s is a closed set holding its default', (_, option) => {
    expect(new Set(option.values).size).toBe(option.values.length)
    expect(option.values).toContain(option.default)
  })

  it('has no align: end', () => {
    expect(OPTIONS.align.values).not.toContain('end')
  })

  it('withholds width: full from articles only', () => {
    expect(valuesFor('width', { id: 'rich-text', group: 'section' })).toContain('full')
    expect(valuesFor('width', { id: 'media', group: 'article' })).toEqual(['prose', 'wide'])
  })

  it('withholds columns: 6 from every block but logo-cloud', () => {
    expect(valuesFor('columns', { id: 'logo-cloud', group: 'section' })).toContain('6')
    expect(valuesFor('columns', { id: 'feature-grid', group: 'section' })).toEqual(['2', '3', '4'])
  })
})

describe('the options of the catalogue', () => {
  it.each(BLOCKS.map((entry) => [entry.id, entry] as const))(
    '%s exposes only options of the vocabulary, with its default',
    (_, entry) => {
      for (const [name, option] of optionsOf(entry)) {
        if (name === 'variant') continue
        const vocabulary = OPTIONS[name as OptionName]
        expect(vocabulary, `${name} is in the vocabulary`).toBeDefined()
        expect(option.default).toBe(vocabulary.default)
        expect(option.values).toContain(option.default)
        for (const value of option.values) expect(vocabulary.values).toContain(value)
      }
      expect(['variant', ...OPTION_NAMES]).toEqual(
        expect.arrayContaining(Object.keys(entry.options))
      )
    }
  )

  // The artboard's "blocks shown" for each option.
  it.each<[OptionName, string[]]>([
    ['layout', ['hero', 'cta', 'testimonials']],
    ['width', ['rich-text', 'media', 'quote', 'gallery']],
    ['columns', ['feature-grid', 'stats', 'pricing', 'logo-cloud']],
    ['density', ['feature-grid', 'gallery', 'logo-cloud', 'testimonials', 'faq', 'post-list']],
    ['align', ['quote', 'cta', 'stats', 'newsletter']],
    ['tone', ['hero', 'cta', 'newsletter', 'stats']],
    ['ratio', ['media', 'slider', 'media-showcase']],
    ['height', ['scene', 'playground', 'hero']],
  ])('%s is exposed by the blocks of the artboard and no others', (name, ids) => {
    expect(
      BLOCKS.filter((entry) => entry.options[name])
        .map((entry) => entry.id)
        .sort()
    ).toEqual([...ids].sort())
  })

  it('offers width: full to no article block, and to a section block that exposes width', () => {
    const articles = BLOCKS.filter((entry) => entry.group === 'article' && entry.options.width)
    expect(articles.map((entry) => entry.id)).toEqual(['quote', 'media'])
    for (const entry of articles) expect(entry.options.width?.values).not.toContain('full')
    expect(block('rich-text').options.width?.values).toContain('full')
  })

  it('offers columns: 6 to logo-cloud only', () => {
    const six = BLOCKS.filter((entry) => entry.options.columns?.values.includes('6'))
    expect(six.map((entry) => entry.id)).toEqual(['logo-cloud'])
  })

  it('lists each option of each block in the generated schema, with its default', () => {
    interface Property {
      enum?: string[]
      default?: string
      anyOf?: Property[]
    }
    const defs = catalogueSchema.$defs as unknown as Record<
      string,
      { properties: Record<string, Property> }
    >
    for (const entry of BLOCKS) {
      for (const [name, option] of optionsOf(entry)) {
        const declared = defs[entry.id].properties[name]
        // An optional field is `anyOf: [field, { type: 'null' }]`.
        const property = declared.anyOf?.find((candidate) => candidate.enum) ?? declared
        expect(property.enum, `${entry.id}.${name}`).toEqual([...option.values])
        expect(property.default).toBe(option.default)
      }
    }
  })

  it("keeps today's content valid: a block with no option set parses", () => {
    const content = { title: 'Welcome' }
    expect(
      blockContentSchema(block('hero')).safeParse({ ...content, variant: 'centered' }).success
    ).toBe(true)
  })

  it('refuses a value outside the set in the content schema', () => {
    const schema = blockContentSchema(featureGrid)
    const content = { variant: 'grid', items: [] }
    expect(schema.safeParse({ ...content, columns: '3' }).error?.issues ?? []).not.toContainEqual(
      expect.objectContaining({ path: ['columns'] })
    )
    expect(schema.safeParse({ ...content, columns: '6' }).error?.issues).toContainEqual(
      expect.objectContaining({ path: ['columns'] })
    )
  })
})

describe('findBlockOptionViolation', () => {
  const grid = (extra: Record<string, unknown>) => ({
    __component: 'section.feature-grid',
    ...extra,
  })

  it('accepts columns: 3, as a number or as stored', () => {
    expect(findBlockOptionViolation([grid({ columns: 3 })])).toBeNull()
    expect(findBlockOptionViolation([grid({ columns: '3' })])).toBeNull()
  })

  it('refuses columns: 6 and names the block, the option and the allowed values', () => {
    expect(findBlockOptionViolation([grid({ columns: 6 })])).toEqual({
      block: 'feature-grid',
      option: 'columns',
      value: 6,
      allowed: ['2', '3', '4'],
    })
  })

  it('accepts columns: 6 on logo-cloud only', () => {
    expect(findBlockOptionViolation([{ __component: 'section.logo-cloud', columns: 6 }])).toBeNull()
    expect(findBlockOptionViolation([{ __component: 'section.stats', columns: 6 }])).not.toBeNull()
  })

  it('refuses an option the block does not expose, with no allowed value', () => {
    expect(findBlockOptionViolation([grid({ ratio: '16:9' })])).toEqual({
      block: 'feature-grid',
      option: 'ratio',
      value: '16:9',
      allowed: [],
    })
  })

  it('refuses width: full on an article block and accepts it on a section block', () => {
    expect(
      findBlockOptionViolation([{ __component: 'shared.media', width: 'full' }])
    ).toMatchObject({
      block: 'media',
      option: 'width',
      allowed: ['prose', 'wide'],
    })
    expect(
      findBlockOptionViolation([{ __component: 'section.rich-text', width: 'full' }])
    ).toBeNull()
  })

  it('refuses align: end', () => {
    expect(findBlockOptionViolation([{ __component: 'section.cta', align: 'end' }])).toMatchObject({
      block: 'cta',
      option: 'align',
      allowed: ['start', 'center'],
    })
  })

  it("refuses a variant outside the block's set, and one on a block with none", () => {
    expect(findBlockOptionViolation([grid({ variant: 'diagonal' })])).toMatchObject({
      option: 'variant',
    })
    expect(
      findBlockOptionViolation([{ __component: 'section.rich-text', variant: 'x' }])
    ).toMatchObject({ block: 'rich-text', option: 'variant', allowed: [] })
  })

  it('refuses a value that is not a string or a number', () => {
    expect(findBlockOptionViolation([grid({ columns: { a: 1 } })])).not.toBeNull()
    expect(findBlockOptionViolation([grid({ columns: true })])).not.toBeNull()
  })

  it('takes absent and null options as their default, and skips what is not a block', () => {
    expect(findBlockOptionViolation([grid({ columns: null, density: undefined })])).toBeNull()
    expect(
      findBlockOptionViolation([{ __component: 'host.own', columns: 99 }, null, 'x'])
    ).toBeNull()
  })

  it('reports the first violation of the zone', () => {
    expect(
      findBlockOptionViolation([grid({ columns: '3' }), grid({ columns: 6 }), grid({ ratio: 'x' })])
    ).toMatchObject({ option: 'columns' })
  })
})

describe('the catalogue fingerprint and the options', () => {
  const current = catalogueFingerprint(BLOCKS)
  const changed = (change: (entry: Block) => Block) =>
    diffFingerprints(
      current,
      catalogueFingerprint(BLOCKS.map((entry) => (entry.id === 'hero' ? change(entry) : entry)))
    )

  it('sees a block as changed when it exposes one more option', () => {
    expect(
      changed((entry) => ({
        ...entry,
        options: {
          ...entry.options,
          density: { values: ['comfortable', 'compact'], default: 'comfortable' },
        },
      }))
    ).toEqual({ added: [], changed: ['hero'], removed: [] })
  })

  it('sees a block as changed when the vocabulary gives one of its options a new value', () => {
    expect(
      changed((entry) => ({
        ...entry,
        options: {
          ...entry.options,
          tone: {
            values: [...(entry.options.tone?.values ?? []), 'vivid'] as never,
            default: 'default',
          },
        },
      }))
    ).toEqual({ added: [], changed: ['hero'], removed: [] })
  })
})
