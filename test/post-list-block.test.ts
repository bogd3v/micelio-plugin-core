import { describe, expect, it } from 'vitest'
import { BLOCKS, blockContentSchema } from '../contract/blocks'
import { strapiComponents } from '../contract/strapi'

const block = BLOCKS.find((entry) => entry.id === 'post-list')
if (!block) throw new Error('no block post-list')

describe('the post-list block (micelio-cms#444)', () => {
  it('offers the featured variant after cards and list, with cards as the default', () => {
    expect(block.options.variant).toEqual({
      values: ['cards', 'list', 'featured'],
      default: 'cards',
    })
  })

  it('offers columns 2, 3 and 4, 3 by default, and withholds 6', () => {
    expect(block.options.columns).toEqual({ values: ['2', '3', '4'], default: '3' })
  })

  it('stores showExcerpt as an optional boolean that is true by default', () => {
    const attributes = strapiComponents(block).components['section.post-list']
    expect(attributes.showExcerpt).toEqual({ type: 'boolean', default: true })
    expect(attributes.showExcerpt.required).toBeUndefined()
  })

  it('stores sort as an optional enumeration of newest, oldest and alphabetical, newest by default', () => {
    const attributes = strapiComponents(block).components['section.post-list']
    expect(attributes.sort).toEqual({
      type: 'enumeration',
      enum: ['newest', 'oldest', 'alphabetical'],
      default: 'newest',
    })
    expect(attributes.sort.required).toBeUndefined()
  })

  it('targets the plugin categories and tags, as the micelio-cms components do', () => {
    const attributes = strapiComponents(block).components['section.post-list']
    expect(attributes.category).toMatchObject({ target: 'plugin::micelio.category' })
    expect(attributes.tag).toMatchObject({ target: 'plugin::micelio.tag' })
  })

  it('validates a list stored before the new fields, and refuses a value outside them', () => {
    const schema = blockContentSchema(block)
    const stored = { variant: 'cards', count: 3 }
    expect(schema.safeParse(stored).success).toBe(true)
    expect(schema.safeParse({ ...stored, variant: 'featured', sort: 'oldest' }).success).toBe(true)
    expect(schema.safeParse({ ...stored, showExcerpt: false, columns: '4' }).success).toBe(true)
    expect(schema.safeParse({ ...stored, sort: 'random' }).success).toBe(false)
    expect(schema.safeParse({ ...stored, showExcerpt: 'no' }).success).toBe(false)
    expect(schema.safeParse({ ...stored, variant: 'hero' }).success).toBe(false)
  })
})
