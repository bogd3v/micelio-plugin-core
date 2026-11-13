import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core } from '@strapi/strapi'
import { ICONS } from '../../contract/icons'
import { cleanupStrapi, setupStrapi } from './harness'

const EMBLEM = 'api::emblem.emblem'
const PASSWORD = 'Password1234'

interface Problem {
  type: string
  title: string
  status: number
  detail: string
  code: string
  field?: string
  path?: string
}

interface Entry {
  name: string
  label: string
  category: string
  source: string
  glyph: string
}

interface Answer {
  set: string
  version: string
  total: number
  count: number
  categories: { name: string; label: string }[]
  entries: Entry[]
}

// The `emblem` fixture has an `icon` of its own, a `badge` component with one and a zone whose
// `fixture.icon-card` block holds one.
describe('the micelio.icon custom field', () => {
  let strapi: Core.Strapi
  let base: string
  let apiToken: string
  let adminToken: string
  let siteSlug: string

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    apiToken = (
      (await strapi.service('admin::api-token').create({
        name: 'icon-field',
        type: 'full-access',
        lifespan: null,
      })) as { accessKey: string }
    ).accessKey
    const role = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-author' },
    })) as { id: number }
    const email = 'icons@example.com'
    await strapi.service('admin::user').create({
      email,
      firstname: 'Author',
      lastname: 'Test',
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
    })
    const login = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    adminToken = ((await login.json()) as { data: { token: string } }).data.token
    const site = (await strapi.db.query('plugin::micelio.site').findOne({
      where: { isDefault: true },
    })) as { slug: string }
    siteSlug = site.slug
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  function save(data: Record<string, unknown>): Promise<Response> {
    // `emblem` is editorial: the content API saves a draft only when it is asked to.
    return fetch(`${base}/api/emblems?status=draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ data: { title: 'An emblem', ...data } }),
    })
  }

  async function refused(response: Response): Promise<Problem> {
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    return (await response.json()) as Problem
  }

  const icons = (query = '') =>
    fetch(`${base}/micelio/icons${query}`, { headers: { Authorization: `Bearer ${adminToken}` } })

  it('is registered as plugin::micelio.icon, a string', () => {
    const fields = (
      strapi.get('custom-fields') as unknown as {
        getAll(): Record<string, { name: string; type: string }>
      }
    ).getAll()
    expect(fields['plugin::micelio.icon']).toMatchObject({ name: 'icon', type: 'string' })
  })

  it('refuses a value that is not a pinned name or alias, naming the field', async () => {
    const problem = await refused(await save({ icon: 'not-an-icon' }))
    expect(problem).toMatchObject({
      code: 'iconInvalid',
      status: 400,
      title: 'Bad Request',
      field: 'icon',
      path: 'icon',
    })
    expect(problem.detail).toContain('not-an-icon')
  })

  it('names the field of a component and of a block of a zone', async () => {
    expect(await refused(await save({ badge: { title: 'A', icon: 'nope' } }))).toMatchObject({
      code: 'iconInvalid',
      field: 'icon',
      path: 'badge.icon',
    })
    const problem = await refused(
      await save({
        sections: [
          { __component: 'section.rich-text', body: 'Text' },
          { __component: 'fixture.icon-card', title: 'Card', icon: 'Bolt' },
        ],
      })
    )
    expect(problem).toMatchObject({ code: 'iconInvalid', field: 'icon', path: 'sections.1.icon' })
  })

  it('refuses a value that is not a string, and the empty string', async () => {
    expect((await refused(await save({ icon: 42 }))).code).toBe('iconInvalid')
    expect((await refused(await save({ icon: '' }))).code).toBe('iconInvalid')
  })

  it('writes nothing when it refuses', async () => {
    const before = await strapi.documents(EMBLEM).count({})
    await save({ icon: 'not-an-icon' })
    expect(await strapi.documents(EMBLEM).count({})).toBe(before)
  })

  it('refuses the same value through the document service, naming the field', async () => {
    const site = (await strapi.db.query('plugin::micelio.site').findOne({
      where: { slug: siteSlug },
    })) as { documentId: string }
    await expect(
      strapi.documents(EMBLEM).create({
        locale: 'en',
        data: { title: 'X', icon: 'nope', site: site.documentId } as never,
      })
    ).rejects.toMatchObject({ details: { code: 'iconInvalid', field: 'icon' } })
  })

  it('accepts a pinned name, none, and every block of the zone', async () => {
    expect(ICONS.names).toContain('bolt')
    const response = await save({
      icon: 'bolt',
      badge: { title: 'A', icon: null },
      sections: [{ __component: 'fixture.icon-card', title: 'Card', icon: 'map-pin' }],
    })
    expect(response.status).toBe(201)
    const { data } = (await response.json()) as { data: { documentId: string; icon: string } }
    expect(data.icon).toBe('bolt')
  })

  it('accepts an alias and stores it as written', async () => {
    const service = strapi.plugin('micelio').service('icons') as {
      setAliasForTests(alias: string, name: string | undefined): void
    }
    // The pin has no rename yet (`ICON_ALIASES`): add the one a later pin would carry.
    service.setAliasForTests('old-bolt', 'bolt')
    try {
      const response = await save({ icon: 'old-bolt' })
      expect(response.status).toBe(201)
      const { data } = (await response.json()) as { data: { documentId: string } }
      const stored = (await strapi.documents(EMBLEM).findOne({
        documentId: data.documentId,
        status: 'draft',
      } as never)) as unknown as { icon: string }
      expect(stored.icon).toBe('old-bolt')
      // The route resolves the alias to the glyph it points to.
      const shown = ((await (await icons('?name=old-bolt')).json()) as { data: Answer }).data
      expect(shown.entries.map((entry) => entry.name)).toEqual(['bolt'])
    } finally {
      service.setAliasForTests('old-bolt', undefined)
    }
    expect((await refused(await save({ icon: 'old-bolt' }))).code).toBe('iconInvalid')
  })

  it('keeps the catalogue frozen and the alias hook for the suites', () => {
    const service = strapi.plugin('micelio').service('icons') as {
      catalogue: { aliases: Record<string, string> }
      setAliasForTests(alias: string, name: string | undefined): void
    }
    expect(Object.isFrozen(service.catalogue)).toBe(true)
    expect(Object.isFrozen(service.catalogue.aliases)).toBe(true)
    const environment = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect(() => service.setAliasForTests('x-bolt', 'bolt')).toThrow(/for the suites/)
    } finally {
      process.env.NODE_ENV = environment
    }
    expect(service.catalogue.aliases['x-bolt']).toBeUndefined()
  })

  it("GET /micelio/icons?site= returns the core's entries for a site whose theme draws none", async () => {
    const response = await icons(`?site=${siteSlug}`)
    expect(response.status).toBe(200)
    const { data } = (await response.json()) as { data: Answer }
    expect(data).toMatchObject({ set: 'tabler', version: ICONS.version, total: ICONS.names.length })
    expect(data.count).toBe(ICONS.names.length)
    expect(data.entries.length).toBeGreaterThan(0)
    expect(data.entries.every((entry) => entry.source === 'core')).toBe(true)
    expect(data.entries.every((entry) => entry.glyph.startsWith('<svg'))).toBe(true)
    expect(data.entries.every((entry) => ICONS.names.includes(entry.name))).toBe(true)
  })

  it('searches by Spanish label and by alias, and labels in the language asked', async () => {
    const found = async (query: string) =>
      ((await (await icons(query)).json()) as { data: Answer }).data
    const spanish = await found('?q=rayo&locale=es')
    expect(spanish.entries.map((entry) => entry.name)).toContain('bolt')
    expect(spanish.entries.find((entry) => entry.name === 'bolt')?.label).toBe('Rayo')
    const english = await found('?q=lightning')
    expect(english.entries.find((entry) => entry.name === 'bolt')?.label).toBe('Bolt')
    const noSpanish = await found('?name=abacus&locale=es')
    expect(noSpanish.entries).toHaveLength(1)
    expect(noSpanish.entries[0]).toMatchObject({ name: 'abacus', label: 'Abacus' })
    const category = await found('?category=Design&limit=500')
    expect(category.entries.every((entry) => entry.category === 'Design')).toBe(true)
    expect(category.count).toBeLessThan(category.total)
  })

  it('caps the entries and pages them', async () => {
    const first = ((await (await icons('?limit=5')).json()) as { data: Answer }).data
    const second = ((await (await icons('?limit=5&offset=5')).json()) as { data: Answer }).data
    expect(first.entries).toHaveLength(5)
    expect(second.entries.map((entry) => entry.name)).not.toEqual(
      first.entries.map((entry) => entry.name)
    )
    const huge = ((await (await icons('?limit=100000')).json()) as { data: Answer }).data
    expect(huge.entries).toHaveLength(500)
  })

  it('answers unknownSite for a slug that no site has', async () => {
    const response = await icons('?site=nowhere')
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'unknownSite' })
  })

  it('is for an admin user only', async () => {
    expect((await fetch(`${base}/micelio/icons`)).status).toBe(401)
  })
})
