import { describe, expect, it } from 'vitest'
import { findInternalLinks } from '../server/src/editorial/links'
import type { AttributesOf } from '../server/src/page-templates/rules'
import editorial from '../server/src/components/editorial/editorial.json'
import { exportPolicyOf } from '../server/src/site-export/names'

// The components as the test app declares them: a call to action with two links, and a block whose
// repeatable items each hold a link.
const COMPONENTS: Record<string, ReturnType<AttributesOf>> = {
  'section.cta': {
    title: { type: 'string' },
    primaryLink: { type: 'component', component: 'section.link' },
    secondaryLink: { type: 'component', component: 'section.link' },
  },
  'section.cards': {
    items: { type: 'component', component: 'section.card', repeatable: true },
  },
  'section.card': {
    link: { type: 'component', component: 'section.link' },
  },
  'section.link': { label: { type: 'string' }, url: { type: 'string' } },
}
const attributesOf: AttributesOf = (uid) => COMPONENTS[uid]

const cta = (primary: string | null, secondary?: string) => ({
  __component: 'section.cta',
  title: 'Go',
  primaryLink: primary === null ? null : { label: 'One', url: primary },
  secondaryLink: secondary === undefined ? undefined : { label: 'Two', url: secondary },
})

describe('findInternalLinks', () => {
  it('finds the paths of the site in links, without their query, fragment or last slash', () => {
    expect(
      findInternalLinks(attributesOf, [
        { __component: 'section.rich-text', body: '/not-a-link' },
        cta('/pricing?plan=pro#top', '/about/'),
      ])
    ).toEqual([
      { block: 'cta', position: 1, field: 'primaryLink', path: '/pricing' },
      { block: 'cta', position: 1, field: 'secondaryLink', path: '/about' },
    ])
  })

  it('leaves out full addresses, protocol-relative ones, mailto, the root and an empty link', () => {
    expect(
      findInternalLinks(attributesOf, [
        cta('https://example.com/pricing', '//cdn.example.com/pricing'),
        cta('mailto:hello@example.com', '/'),
        cta(null),
        cta('pricing'),
      ])
    ).toEqual([])
  })

  it('names a link inside a repeatable part by its place', () => {
    expect(
      findInternalLinks(attributesOf, [
        {
          __component: 'section.cards',
          items: [{ link: { label: 'A', url: 'https://a.example' } }, { link: { url: '/b' } }],
        },
      ])
    ).toEqual([{ block: 'section.cards', position: 0, field: 'items[1].link', path: '/b' }])
  })
})

describe('the note of the editorial component', () => {
  it('is private for the content API and still written to a site archive', () => {
    const note = editorial.attributes.note as Parameters<typeof exportPolicyOf>[0]
    expect(note).toMatchObject({ type: 'text', private: true, maxLength: 1000 })
    expect(exportPolicyOf(note)).toBe('always')
  })
})
