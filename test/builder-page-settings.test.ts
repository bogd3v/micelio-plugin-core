import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VISIBILITY,
  isSlugValid,
  offeredPageTypes,
  pageTypeName,
  visibilityOf,
} from '../admin/src/utils/builder/pageSettings'

describe('the slug of a page', () => {
  it.each(['open-source', 'a', 'v1.2_final~x'])('accepts %s', (slug) => {
    expect(isSlugValid(slug)).toBe(true)
  })

  it.each(['', 'a/b', 'a b', '.', '..', 'a?b', 'a#b', 'ñandú'])('refuses "%s"', (slug) => {
    expect(isSlugValid(slug)).toBe(false)
  })
})

describe('the visibility of a page', () => {
  it('reads a page that never saved the component as in the menu and the sitemap, indexable', () => {
    expect(visibilityOf(undefined)).toEqual(DEFAULT_VISIBILITY)
    expect(visibilityOf(null)).toEqual({ inMenu: true, inSitemap: true, noindex: false })
  })

  it('reads what the component holds, with the default for what it lacks or holds wrongly', () => {
    expect(visibilityOf({ inMenu: false, noindex: 'yes', inSitemap: null })).toEqual({
      inMenu: false,
      inSitemap: true,
      noindex: false,
    })
    expect(visibilityOf({ noindex: true })).toEqual({
      inMenu: true,
      inSitemap: true,
      noindex: true,
    })
  })
})

describe('the page types the drawer offers', () => {
  const listed = [
    { id: 'long-read', budgetKb: 200 },
    { id: 'standard', budgetKb: 120 },
    { id: 'landing', budgetKb: 60 },
  ]

  it('orders them from the lightest budget to the heaviest', () => {
    expect(offeredPageTypes(listed, 'standard').map(({ id }) => id)).toEqual([
      'landing',
      'standard',
      'long-read',
    ])
  })

  it('keeps the type of a page the site no longer lists, with the standard budget', () => {
    expect(offeredPageTypes(listed, 'retired')).toContainEqual({ id: 'retired', budgetKb: 120 })
  })

  it('offers nothing before the site’s types are known', () => {
    expect(offeredPageTypes([], 'standard')).toEqual([])
  })

  it('names a type as a person reads it', () => {
    expect(pageTypeName('long-read')).toBe('Long read')
    expect(pageTypeName('landing')).toBe('Landing')
  })
})
