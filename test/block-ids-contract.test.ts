import { describe, expect, it } from 'vitest'
import { BLOCKS } from '../contract/blocks'
import { strapiComponents } from '../contract/strapi'

// The instance ids (ADR-0018, section 1; micelio-cms#440): every block has a `blockId` and every
// repeatable item an `itemId`, optional strings, in the catalogue's schema.
describe('the instance ids in the catalogue', () => {
  it.each(BLOCKS.map((block) => [block.id, block] as const))('%s has a blockId', (_, block) => {
    const { components, component } = strapiComponents(block)
    expect(components[component].blockId).toMatchObject({ type: 'string' })
    expect(components[component].blockId).not.toHaveProperty('required')
  })

  it('gives every repeatable item an itemId, and nothing else', () => {
    const items = new Set<string>()
    const others = new Set<string>()
    for (const block of BLOCKS) {
      const { components, component } = strapiComponents(block)
      for (const [uid, attributes] of Object.entries(components)) {
        if (uid === component) continue
        if ('itemId' in attributes) items.add(uid)
        if ('blockId' in attributes) others.add(uid)
      }
    }
    expect([...items].sort()).toEqual([
      'section.faq-item',
      'section.feature-item',
      'section.logo',
      'section.plan',
      'section.stat',
      'section.testimonial',
      'shared.slide',
    ])
    expect([...others]).toEqual([])
  })
})
