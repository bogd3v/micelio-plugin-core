import { describe, expect, it } from 'vitest'
import type { SiteWithSections } from '../server/src/types/status'
import en from '../admin/src/translations/en.json'
import es from '../admin/src/translations/es.json'
import {
  DEFAULT_LOCALES,
  formValuesOf,
  matchesSearch,
  parseHosts,
  refusalOf,
  refusalText,
  saveBodyOf,
} from '../admin/src/utils/sitesPage'

const site = (patch: Partial<SiteWithSections>): SiteWithSections => ({
  documentId: 'a',
  name: 'Demo site',
  slug: 'demo',
  hosts: ['demo.example.test', 'www.demo.example.test'],
  isDefault: true,
  origin: null,
  theme: null,
  sections: {},
  ...patch,
})

// The pure parts of the Sites page (`admin/src/utils/sitesPage.ts`); the page itself is in
// test/admin/sites-page.test.ts.
describe('the Sites page helpers', () => {
  it('reads the form values from the Content Manager entry', () => {
    expect(
      formValuesOf({
        name: 'Demo',
        slug: 'demo',
        hosts: ['a.test', 7, 'b.test'],
        defaultLocale: 'es',
        isDefault: true,
        description: 'ignored',
      })
    ).toEqual({
      name: 'Demo',
      slug: 'demo',
      hosts: 'a.test, b.test',
      defaultLocale: 'es',
      isDefault: true,
    })
    expect(formValuesOf({ hosts: null, name: null })).toEqual({
      name: '',
      slug: '',
      hosts: '',
      defaultLocale: DEFAULT_LOCALES[0],
      isDefault: false,
    })
  })

  it('takes the default locales from the type', () => {
    expect(DEFAULT_LOCALES).toEqual(['en', 'es'])
  })

  it('splits the hosts on commas, trimmed, and sends only the five fields', () => {
    expect(parseHosts(' a.test ,, b.test,  ')).toEqual(['a.test', 'b.test'])
    expect(parseHosts('')).toEqual([])
    expect(
      saveBodyOf({
        name: ' Demo ',
        slug: 'demo',
        hosts: 'a.test, b.test',
        defaultLocale: 'en',
        isDefault: false,
      })
    ).toEqual({
      name: 'Demo',
      slug: 'demo',
      hosts: ['a.test', 'b.test'],
      defaultLocale: 'en',
      isDefault: false,
    })
  })

  it('matches a site by name, slug or host, in any case', () => {
    expect(matchesSearch(site({}), '')).toBe(true)
    expect(matchesSearch(site({}), '  ')).toBe(true)
    expect(matchesSearch(site({}), 'DEMO SITE')).toBe(true)
    expect(matchesSearch(site({}), 'emo')).toBe(true)
    expect(matchesSearch(site({}), 'WWW.demo.example')).toBe(true)
    expect(matchesSearch(site({ hosts: [] }), 'example')).toBe(false)
    expect(matchesSearch(site({}), 'landing')).toBe(false)
  })

  it("translates the server's refusals that have a message and keeps the others as written", () => {
    const messages =
      (lang: Record<string, string>) => (id: string, values?: Record<string, string | number>) =>
        (lang[id] ?? id).replace(/\{(\w+)\}/g, (_, key: string) => String(values?.[key] ?? ''))
    expect(refusalText('Another site already has the host "a.test"', messages(en))).toBe(
      'Another site already has the host "a.test".'
    )
    expect(refusalText('Another site already has the host "a.test"', messages(es))).toBe(
      'Otro sitio ya tiene el host «a.test».'
    )
    expect(refusalText('Make another site the default instead', messages(es))).toBe(
      'Haz que otro sitio sea el predeterminado.'
    )
    expect(refusalText('slug must be unique', messages(es))).toBe('slug must be unique')
  })

  it('reads the message of a refusal the admin client threw', () => {
    expect(refusalOf({ message: 'x', response: { data: { error: { message: 'Taken' } } } })).toBe(
      'Taken'
    )
    expect(refusalOf(new Error('Network down'))).toBe('Network down')
    expect(refusalOf(undefined)).toBe('')
  })
})
