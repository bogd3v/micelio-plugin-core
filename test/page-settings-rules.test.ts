import { describe, expect, it } from 'vitest'
import { hasPageSettings, withPageSettings } from '../server/src/page-settings'
import {
  isSitePath,
  pathOfSlug,
  planRedirects,
  type RedirectRow,
} from '../server/src/page-settings/redirects'
import { withSiteScope, type ContentTypeSchema } from '../server/src/site-scope'

const row = (documentId: string, from: string, to: string): RedirectRow => ({
  documentId,
  from,
  to,
})

describe('the redirect plan of a slug change', () => {
  const change = { from: pathOfSlug('old'), to: pathOfSlug('new') }

  it('redirects the old address to the new one', () => {
    expect(planRedirects(change, [])).toEqual({
      retarget: [],
      remove: [],
      create: { from: '/old', to: '/new' },
    })
  })

  it('points what redirected to the old address at the new one', () => {
    expect(planRedirects(change, [row('a', '/older', '/old')])).toEqual({
      retarget: ['a'],
      remove: [],
      create: { from: '/old', to: '/new' },
    })
  })

  it('removes a redirect from the address the page returns to', () => {
    // `/new` redirects to `/old` from an earlier change: the page now lives at `/new` again.
    expect(planRedirects(change, [row('a', '/new', '/old')])).toEqual({
      retarget: [],
      remove: ['a'],
      create: { from: '/old', to: '/new' },
    })
  })

  it('does not retarget a redirect it removes', () => {
    expect(planRedirects(change, [row('a', '/new', '/old')]).retarget).toEqual([])
  })

  it('retargets a redirect from the old address that already exists instead of adding a second', () => {
    expect(planRedirects(change, [row('a', '/old', '/elsewhere')])).toEqual({
      retarget: ['a'],
      remove: [],
      create: null,
    })
  })
})

describe('withPageSettings', () => {
  const schema: ContentTypeSchema = withPageSettings({ attributes: { title: { type: 'string' } } })

  it('adds the page type and the visibility component, and keeps the rest', () => {
    expect(schema.attributes).toMatchObject({
      title: { type: 'string' },
      pageType: { type: 'string', default: 'standard' },
      visibility: { type: 'component', component: 'micelio-page.visibility', repeatable: false },
    })
  })

  it('marks the type, and composes with withSiteScope', () => {
    expect(hasPageSettings(schema)).toBe(true)
    expect(hasPageSettings(withSiteScope<ContentTypeSchema>({ attributes: {} }))).toBe(false)
    const both = withSiteScope(schema)
    expect(hasPageSettings(both)).toBe(true)
    expect(both.pluginOptions?.micelio).toEqual({ pageSettings: true, siteScoped: true })
  })
})

describe('isSitePath', () => {
  it('accepts a path of the site', () => {
    for (const ok of ['/a', '/a/b', '/a-b_c', '/', '/a?x=1#y']) expect(isSitePath(ok)).toBe(true)
  })

  it('refuses an address that leaves the site or is not a path', () => {
    const bad = [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'a',
      '',
      '/a b',
      '/a\nb',
      '/a\\b',
      '/a\u0000',
      null,
      42,
    ]
    for (const value of bad) expect(isSitePath(value)).toBe(false)
  })
})
