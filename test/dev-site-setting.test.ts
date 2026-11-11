import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// The fixture of compose.dev.yml that answers `GET /api/site-setting` (docker/cms/src/api/site-setting/).
// No boot: the controller runs on a fake `strapi` that holds the rows of `plugin::micelio.site`.

const require = createRequire(import.meta.url)
const controller = require('../docker/cms/src/api/site-setting/controllers/site-setting.js')
const route = require('../docker/cms/src/api/site-setting/routes/site-setting.js')

// The `body.data` keys of the route `site-setting.find` in micelio-cms v0.6.0
// (src/constants/response-fields/site.ts at that tag), `required` and `surplus` alike, copied by hand.
const DATA_KEYS = [
  'name', 'description', 'url', 'defaultLocale', 'contactEmail', 'privacyContactEmail',
  'privacyUpdatedAt', 'supportHandle', 'author', 'logo', 'favicon', 'defaultOgImage',
  'socialLinks', 'modules', 'theme', 'homePage', 'id', 'documentId', 'tagline',
  'securityContact', 'privacyJurisdiction', 'timezone', 'addressLocality', 'locale',
  'createdAt', 'updatedAt', 'publishedAt',
] // prettier-ignore
const IMAGE_KEYS = ['url', 'alternativeText', 'width', 'height', 'id', 'documentId']

const image = {
  id: 3,
  documentId: 'img',
  url: '/uploads/logo.png',
  alternativeText: 'Logo',
  width: 64,
  height: 64,
  mime: 'image/png',
  hash: 'x',
}
const site = {
  id: 1,
  documentId: 'site1',
  name: 'Example Site',
  slug: 'default',
  hosts: ['localhost'],
  isDefault: true,
  editorialPolicy: { secret: true },
  description: 'A site',
  url: 'http://localhost:3000',
  defaultLocale: 'en',
  locale: 'en',
  logo: image,
  author: { id: 9, name: 'Ada', url: 'https://example.com', extra: 1 },
  socialLinks: [{ id: 4, network: 'mastodon', url: 'https://example.social/@a', extra: 1 }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

type Image = Record<string, unknown>
type Data = Record<string, unknown> & { logo: Image }
type Params = { locale?: string; filters?: unknown; uid?: string }

async function run(
  rows: Record<string, unknown>[],
  query: Record<string, unknown> = {}
): Promise<{ body: unknown; calls: Params[] }> {
  const calls: Params[] = []
  const strapi = {
    documents: (uid: string) => ({
      findFirst: async (params: Params) => {
        calls.push({ uid, ...params })
        return (
          rows.find((row) =>
            params.locale ? row.locale === params.locale : row.locale === 'en'
          ) ?? null
        )
      },
    }),
  }
  const ctx = { query, notFound: (message: string) => ({ notFound: message }) }
  const body: unknown = await controller({ strapi }).find(ctx)
  return { body, calls }
}

describe('the site-setting fixture of compose.dev.yml', () => {
  it('the site-setting fixture answers the default site with the fields of micelio-cms v0.6.0 the frontend reads', async () => {
    expect(route.routes).toEqual([
      { method: 'GET', path: '/site-setting', handler: 'site-setting.find' },
    ])

    const { body, calls } = await run([site])
    const { data, meta } = body as { data: Data; meta: object }
    expect(calls[0]).toMatchObject({ uid: 'plugin::micelio.site', filters: { isDefault: true } })
    expect(meta).toEqual({})
    // Exactly the keys of v0.6.0: nothing of the core's own (slug, hosts, editorialPolicy).
    expect(Object.keys(data).sort()).toEqual([...DATA_KEYS].sort())
    expect(data).toMatchObject({
      name: 'Example Site',
      url: 'http://localhost:3000',
      defaultLocale: 'en',
      description: 'A site',
    })
    expect(Object.keys(data.logo).sort()).toEqual([...IMAGE_KEYS].sort())
    expect(data.logo).toMatchObject({ url: '/uploads/logo.png', width: 64 })
    expect(data.favicon).toBeNull()
    expect(data.author).toEqual({ name: 'Ada', url: 'https://example.com', id: 9 })
    expect(data.socialLinks).toEqual([
      { network: 'mastodon', url: 'https://example.social/@a', id: 4 },
    ])
    // What the core's site does not hold answers empty, so the frontend keeps its defaults.
    expect([data.modules, data.theme, data.homePage]).toEqual([null, null, null])
    expect(data.tagline).toBeNull()
  })

  it('answers the default locale for a locale the site has no row in, and a 404 with no default site', async () => {
    const { body, calls } = await run([site], { locale: 'es' })
    expect((body as { data: Data }).data.name).toBe('Example Site')
    expect(calls.map((call) => call.locale)).toEqual(['es', undefined])
    expect((await run([])).body).toEqual({ notFound: 'No default site' })
  })
})
