import { describe, expect, it } from 'vitest'
import { normalizeHosts } from '../server/src/site-scope/hosts'
import { pickSite, type SiteSummary } from '../server/src/site-scope/resolve'

const main: SiteSummary = { documentId: 'a', slug: 'main', hosts: ['example.com'], isDefault: true }
const other: SiteSummary = {
  documentId: 'b',
  slug: 'other',
  hosts: ['other.test'],
  isDefault: false,
}
const sites = [main, other]

describe('pickSite', () => {
  it('picks the site a slug names', () => {
    expect(pickSite(sites, { slug: 'other', host: 'example.com' })).toBe(other)
  })

  it('answers nothing for a slug no site has, whatever the host', () => {
    expect(pickSite(sites, { slug: 'missing', host: 'other.test' })).toBeUndefined()
  })

  it('picks the site that lists the host, in any case', () => {
    expect(pickSite(sites, { host: 'OTHER.test' })).toBe(other)
  })

  it('falls back to the default site for an unknown host or none', () => {
    expect(pickSite(sites, { host: 'cms.example.net' })).toBe(main)
    expect(pickSite(sites, {})).toBe(main)
  })

  it('answers nothing when no site is the default', () => {
    expect(pickSite([other], {})).toBeUndefined()
  })
})

describe('normalizeHosts', () => {
  it('lowercases, trims and drops repeats', () => {
    expect(normalizeHosts([' Example.COM', 'example.com', 'www.example.com'])).toEqual([
      'example.com',
      'www.example.com',
    ])
  })

  it('reads null and undefined as no host names', () => {
    expect(normalizeHosts(null)).toEqual([])
    expect(normalizeHosts(undefined)).toEqual([])
  })

  it.each([
    ['https://example.com'],
    ['example.com:8080'],
    ['example.com/path'],
    ['-example.com'],
    ['exa mple.com'],
    [''],
  ])('rejects %j', (host) => {
    expect(normalizeHosts([host])).toEqual({ error: expect.stringContaining('is not a host name') })
  })

  it('rejects a value that is not a list of strings', () => {
    expect(normalizeHosts('example.com')).toHaveProperty('error')
    expect(normalizeHosts([1])).toHaveProperty('error')
  })
})
