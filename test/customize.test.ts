import { describe, expect, it } from 'vitest'
import {
  DISPLAY_FONTS,
  MODULE_KEYS,
  accentResult,
  blocksSave,
  candidatesOf,
  contrastRoute,
  customizationOf,
  customizeBodyOf,
  isLinkUrl,
  parseContrastAnswer,
  type ContrastAnswer,
  type ContrastPair,
} from '../admin/src/utils/customize'
import en from '../admin/src/translations/en.json'
import es from '../admin/src/translations/es.json'

const pair = (role: string, surface: string, ratio: number, passes = true): ContrastPair => ({
  role,
  surface,
  ratio,
  min: 4.5,
  passes,
})

const answer = (
  modes: { mode: string; accent: string | null; pairs?: ContrastPair[] }[]
): ContrastAnswer => ({
  theme: 'espora',
  modes: modes.map(({ mode, accent, pairs }) => ({
    mode,
    accent,
    pairs: pairs ?? [pair('accent', 'surface', 5.1), pair('ink', 'surface', 12.3)],
  })),
})

// The site's entry as the Content Manager's admin API answers it: the fields the page edits, and
// others it never touches.
const ENTRY = {
  documentId: 'site1',
  name: 'Demo site',
  slug: 'demo',
  hosts: ['demo.example.test'],
  isDefault: true,
  tagline: 'Notes',
  description: 'A small site.',
  url: 'https://demo.example.test',
  contactEmail: 'hello@example.test',
  timezone: 'America/Bogota',
  logo: { id: 7, name: 'logo.svg', url: '/uploads/logo.svg', alternativeText: null },
  favicon: { id: 8, name: 'favicon.png', url: '/uploads/favicon.png' },
  author: { id: 3, name: 'Ada', url: 'https://ada.example.test' },
  modules: {
    id: 4,
    newsletter: true,
    comments: false,
    accounts: true,
    drafts: true,
    fediverse: true,
    search: true,
    support: true,
  },
  socialLinks: [
    { id: 5, network: 'mastodon', url: 'https://social.example.test/@demo' },
    { id: 6, network: 'myspace', url: 'https://myspace.example.test' },
  ],
  theme: {
    id: 9,
    themeId: 'espora',
    themeVersion: '0.2.0',
    themeDigest: 'sha256-abc',
    defaultMode: 'dark',
    displayFont: 'fraunces',
    accentOverrides: [
      { id: 10, mode: 'light', color: '#276A3F' },
      { id: 11, mode: 'dark', color: 'green' },
    ],
  },
  fediverse: { id: 12, username: 'demo' },
}

describe('the AA result of a mode on the Customize page', () => {
  it("reads a mode as passing, adjusted or failing from the contrast route's answer for its candidate", () => {
    // Passes: the frontend renders the candidate as given (compared without case), every pair passes.
    const passes = answer([{ mode: 'light', accent: '#276a3f' }])
    expect(accentResult(passes, 'light', '#276A3F')).toEqual({ kind: 'passes' })

    // Adjusted: the frontend would move it; the nearest passing shade is offered, with the accent pair.
    const adjusted = answer([{ mode: 'light', accent: '#1f5a34' }])
    expect(accentResult(adjusted, 'light', '#3f8a56')).toEqual({
      kind: 'adjusted',
      shade: '#1f5a34',
      pair: pair('accent', 'surface', 5.1),
    })

    // Fails: no shade reaches contrast (the theme's accent would stay).
    const none = answer([{ mode: 'dark', accent: null }])
    expect(accentResult(none, 'dark', '#ffff00')).toEqual({ kind: 'fails', pair: undefined })

    // Fails: a pair of the mode does not pass, and it is the pair the page names.
    const failingPair = pair('on-accent', 'accent', 3.2, false)
    const pairFails = answer([
      { mode: 'light', accent: '#276a3f', pairs: [pair('ink', 'surface', 12), failingPair] },
    ])
    expect(accentResult(pairFails, 'light', '#276a3f')).toEqual({
      kind: 'fails',
      pair: failingPair,
    })

    // No candidate: the theme's own accent, which the page has nothing to change about.
    expect(accentResult(none, 'dark', undefined)).toEqual({ kind: 'theme' })
    expect(accentResult(pairFails, 'light', undefined)).toEqual({ kind: 'theme' })

    // A mode the answer does not list is not known.
    expect(accentResult(passes, 'sepia', '#276a3f')).toEqual({ kind: 'unknown' })

    // Only an adjusted or failing candidate keeps Save off.
    expect(blocksSave({ kind: 'adjusted' })).toBe(true)
    expect(blocksSave({ kind: 'fails' })).toBe(true)
    for (const kind of ['passes', 'theme', 'unknown', 'checking', 'unchecked']) {
      expect(blocksSave({ kind })).toBe(false)
    }
  })

  it("reads the frontend's answer only in its shape", () => {
    const body = {
      data: {
        theme: 'espora',
        modes: [
          {
            mode: 'light',
            accent: {
              accent: '#276a3f',
              accentSoft: '#dfe9d9',
              accentHover: '#1f5a34',
              onAccent: '#ffffff',
            },
            pairs: [{ role: 'accent', surface: 'surface', ratio: 5.12, min: 4.5, passes: true }],
          },
          {
            mode: 'dark',
            accent: null,
            pairs: [{ role: 'ink', surface: 'surface', ratio: null, min: 4.5, passes: false }],
          },
        ],
      },
    }
    expect(parseContrastAnswer(body)).toEqual({
      theme: 'espora',
      modes: [
        {
          mode: 'light',
          accent: '#276a3f',
          pairs: [{ role: 'accent', surface: 'surface', ratio: 5.12, min: 4.5, passes: true }],
        },
        {
          mode: 'dark',
          accent: null,
          pairs: [{ role: 'ink', surface: 'surface', ratio: null, min: 4.5, passes: false }],
        },
      ],
    })
    expect(parseContrastAnswer({})).toBeNull()
    expect(
      parseContrastAnswer({ data: { modes: [{ mode: 'light', accent: 5, pairs: [] }] } })
    ).toBeNull()
    expect(
      parseContrastAnswer({
        data: { modes: [{ mode: 'light', accent: null, pairs: [{ role: 'a' }] }] },
      })
    ).toBeNull()
  })

  it("asks the contrast route on the site's own origin and path, with the grant's document and no token", () => {
    expect(
      contrastRoute('https://demo.example.test/_preview?token=secret', 'page1', [
        { mode: 'dark', color: '#ffffff' },
        { mode: 'light', color: '#276a3f' },
      ])
    ).toBe(
      'https://demo.example.test/_micelio/contrast?documentId=page1&accent=dark%3A%23ffffff&accent=light%3A%23276a3f'
    )
    expect(contrastRoute('https://demo.example.test/blog/_preview?token=x', 'p', [])).toBe(
      'https://demo.example.test/blog/_micelio/contrast?documentId=p'
    )
    expect(contrastRoute('not a url', 'p', [])).toBeUndefined()
    expect(contrastRoute('ftp://demo.example.test/_preview', 'p', [])).toBeUndefined()
    // Only `#RRGGBB` accents of a mode slug are asked about, in the order of their modes.
    expect(
      candidatesOf({ light: '#276a3f', dark: '#12', Sepia: '#000000', dim: '#AABBCC' })
    ).toEqual([
      { mode: 'dim', color: '#AABBCC' },
      { mode: 'light', color: '#276a3f' },
    ])
  })
})

describe('the save of the Customize page', () => {
  it('sends only the fields the page edits, and the theme pin as it was read', () => {
    const values = customizationOf(ENTRY)
    // What the form reads: an unknown network and an accent that is not `#RRGGBB` are left out.
    expect(values.socialLinks).toEqual([
      { network: 'mastodon', url: 'https://social.example.test/@demo' },
    ])
    expect(values.accents).toEqual({ light: '#276A3F' })
    expect(values.modules.comments).toBe(false)

    const body = customizeBodyOf({
      ...values,
      tagline: '  New tagline ',
      modules: { ...values.modules, support: false },
      accents: { ...values.accents, dark: '#ffffff' },
      socialLinks: [
        ...values.socialLinks,
        { network: 'codeberg', url: 'https://codeberg.org/demo' },
      ],
    })
    expect(Object.keys(body).sort()).toEqual(
      ['author', 'description', 'logo', 'modules', 'name', 'socialLinks', 'tagline', 'theme'].sort()
    )
    expect(body).toEqual({
      name: 'Demo site',
      tagline: 'New tagline',
      description: 'A small site.',
      logo: 7,
      author: { name: 'Ada', url: 'https://ada.example.test' },
      modules: {
        newsletter: true,
        comments: false,
        accounts: true,
        drafts: true,
        fediverse: true,
        search: true,
        support: false,
      },
      socialLinks: [
        { network: 'mastodon', url: 'https://social.example.test/@demo' },
        { network: 'codeberg', url: 'https://codeberg.org/demo' },
      ],
      theme: {
        themeId: 'espora',
        themeVersion: '0.2.0',
        themeDigest: 'sha256-abc',
        accentOverrides: [
          { mode: 'dark', color: '#ffffff' },
          { mode: 'light', color: '#276A3F' },
        ],
        displayFont: 'fraunces',
        defaultMode: 'dark',
      },
    })

    // An empty site: no author, no logo, the theme's own font and mode, every module on, an empty pin.
    const empty = customizeBodyOf(customizationOf({ name: 'Plain' }))
    expect(empty).toEqual({
      name: 'Plain',
      tagline: null,
      description: null,
      logo: null,
      author: null,
      modules: Object.fromEntries(MODULE_KEYS.map((key) => [key, true])),
      socialLinks: [],
      theme: {
        themeId: null,
        themeVersion: null,
        themeDigest: null,
        accentOverrides: [],
        displayFont: null,
        defaultMode: null,
      },
    })
  })

  it('offers the five display fonts and the seven modules, and checks a link as the site stores it', () => {
    expect(DISPLAY_FONTS).toEqual([
      'archivo',
      'fraunces',
      'bricolage-grotesque',
      'newsreader',
      'space-grotesk',
    ])
    expect(MODULE_KEYS).toHaveLength(7)
    // A link's URL, and the author's, as the site stores them: http(s), no spaces.
    expect(isLinkUrl(' https://social.example.test/@demo ')).toBe(true)
    expect(isLinkUrl('http://codeberg.org/demo')).toBe(true)
    expect(isLinkUrl('social.example.test/@demo')).toBe(false)
    expect(isLinkUrl('https://social.example.test/@de mo')).toBe(false)
    expect(isLinkUrl('')).toBe(false)
    // A font outside the enumeration reads as the theme's own.
    expect(customizationOf({ theme: { displayFont: 'comic-sans' } }).displayFont).toBe('')
    // Every module has its line and its name in both languages.
    for (const key of MODULE_KEYS) {
      for (const id of [`customize.module.${key}`, `customize.module.${key}.name`]) {
        expect(en, id).toHaveProperty([id])
        expect(es, id).toHaveProperty([id])
      }
    }
  })
})
