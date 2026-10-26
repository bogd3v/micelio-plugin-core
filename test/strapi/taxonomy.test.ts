import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import fixture from '../fixtures/micelio-cms-v0.5.0-taxonomy-schemas.json'
import { SITE_UID } from '../../server/src/constants/site'
import { CATEGORY_UID, TAG_UID } from '../../server/src/constants/taxonomy'
import { cleanupStrapi, setupStrapi } from './harness'

type Schema = {
  collectionName: string
  info: Record<string, unknown>
  options: Record<string, unknown>
  pluginOptions: Record<string, unknown>
  attributes: Record<string, Record<string, unknown>>
}

// What Strapi adds to every type itself, and what `withSiteScope` adds on top.
const SYSTEM_ATTRIBUTES = new Set([
  'id',
  'documentId',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'locale',
  'localizations',
])

// The inverse side of a host type: the distribution adds it (ADR-0017, amendment of 2026-10-26, D5).
const INVERSE = 'articles'

describe('category and tag in the core', () => {
  let strapi: Core.Strapi
  let base: string
  let token: string
  let defaultSite: string
  let otherSite: string

  const categories = () => strapi.documents(CATEGORY_UID as UID.ContentType)
  const tags = () => strapi.documents(TAG_UID as UID.ContentType)

  const get = (path: string) =>
    fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } })

  async function names(path: string): Promise<string[]> {
    const response = await get(path)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { name: string }[] }
    return body.data.map((entry) => entry.name).sort()
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const created = (await strapi.service('admin::api-token').create({
      name: 'taxonomy-test',
      type: 'read-only',
      lifespan: null,
    })) as { accessKey: string }
    token = created.accessKey

    const sites = strapi.documents(SITE_UID as UID.ContentType)
    defaultSite = (await sites.findFirst({ filters: { isDefault: true } }))!.documentId
    otherSite = (
      await sites.create({
        data: {
          name: 'Other',
          slug: 'other',
          hosts: ['other.test'],
          isDefault: false,
          defaultLocale: 'en',
          modules: {},
        },
      })
    ).documentId

    await categories().create({
      locale: 'en',
      data: { name: 'Essays', slug: 'essays', site: defaultSite },
    })
    await categories().create({
      locale: 'en',
      data: { name: 'Elsewhere', slug: 'elsewhere', site: otherSite },
    })
    await tags().create({ data: { name: 'Privacy', slug: 'privacy', site: defaultSite } })
    await tags().create({ data: { name: 'Other tag', slug: 'other-tag', site: otherSite } })
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  describe.each([
    ['category', CATEGORY_UID],
    ['tag', TAG_UID],
  ] as const)('the %s type', (name, uid) => {
    const expected = (fixture as unknown as Record<string, Schema>)[name]!
    const loaded = () => strapi.contentType(uid as UID.ContentType) as unknown as Schema

    it('exists under the UID micelio-cms 0.5.0 stores', () => {
      expect(strapi.contentTypes[uid as UID.ContentType]).toBeDefined()
    })

    it('keeps the table, the names and the options of micelio-cms 0.5.0', () => {
      expect(loaded().collectionName).toBe(expected.collectionName)
      expect(loaded().info).toMatchObject(expected.info)
      expect(loaded().options).toMatchObject(expected.options)
      expect(loaded().pluginOptions).toMatchObject({ i18n: expected.pluginOptions.i18n })
    })

    it('keeps every attribute of micelio-cms 0.5.0 but the inverse relation, and adds the site', () => {
      const own = Object.keys(loaded().attributes).filter((key) => !SYSTEM_ATTRIBUTES.has(key))
      const kept = Object.keys(expected.attributes).filter((key) => key !== INVERSE)
      expect(own.sort()).toEqual([...kept, 'site'].sort())
      for (const key of kept) {
        expect(loaded().attributes[key], key).toMatchObject(expected.attributes[key]!)
      }
      expect(loaded().attributes.site).toMatchObject({
        type: 'relation',
        relation: 'manyToOne',
        target: SITE_UID,
        required: true,
      })
    })

    it('has no inverse relation to a type of the host', () => {
      expect(loaded().attributes[INVERSE]).toBeUndefined()
    })

    it('shows in the Content Manager', () => {
      expect(loaded().pluginOptions['content-manager']).toMatchObject({ visible: true })
    })
  })

  describe('the content API', () => {
    it('lists the categories of the default site at /api/categories', async () => {
      expect(await names('/api/categories?locale=en')).toEqual(['Essays'])
    })

    it('lists the tags of the default site at /api/tags', async () => {
      expect(await names('/api/tags')).toEqual(['Privacy'])
    })

    it('lists the entries of the site the `site` parameter names', async () => {
      expect(await names('/api/categories?locale=en&site=other')).toEqual(['Elsewhere'])
      expect(await names('/api/tags?site=other')).toEqual(['Other tag'])
    })

    it('finds one entry by its document id, in its site only', async () => {
      const essays = await categories().findFirst({ filters: { slug: 'essays' } })
      const elsewhere = await categories().findFirst({ filters: { slug: 'elsewhere' } })
      const found = await get(`/api/categories/${essays!.documentId}?locale=en`)
      expect(found.status).toBe(200)
      expect(await get(`/api/categories/${elsewhere!.documentId}?locale=en`)).toHaveProperty(
        'status',
        404
      )
    })

    it.each(['/api/categories', '/api/tags'])(
      'answers unknownSite as a problem detail on %s for a site that does not exist',
      async (path) => {
        const response = await get(`${path}?site=missing`)
        expect(response.status).toBe(404)
        expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/)
        expect(await response.json()).toMatchObject({ status: 404, code: 'unknownSite' })
      }
    )

    it('does not answer under the plugin prefix', async () => {
      expect((await get('/api/micelio/categories')).status).toBe(404)
      expect((await get('/api/micelio/tags')).status).toBe(404)
    })

    const post = (path: string, key: string) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { name: 'Posted', slug: 'posted' } }),
      })

    it('refuses a write with a read-only token', async () => {
      expect((await post('/api/tags?site=other', token)).status).toBe(403)
      expect((await post('/api/categories?site=other', token)).status).toBe(403)
    })

    it('checks each route against its own action', async () => {
      // A custom token that may only read categories: not the tags, and no write at all.
      const created = (await strapi.service('admin::api-token').create({
        name: 'taxonomy-category-find',
        type: 'custom',
        lifespan: null,
        permissions: [`${CATEGORY_UID}.find`],
      })) as { accessKey: string }
      const key = created.accessKey

      const read = (path: string) =>
        fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${key}` } })
      expect((await read('/api/categories')).status).toBe(200)
      expect((await read('/api/tags')).status).toBe(403)
      expect((await post('/api/categories', key)).status).toBe(403)
      expect((await post('/api/tags', key)).status).toBe(403)
    })
  })
})
