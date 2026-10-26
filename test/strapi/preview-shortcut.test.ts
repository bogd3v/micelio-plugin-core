import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { previewPageUrl, registerPreviewShortcut } from '../../server/src/preview/shortcut'
import { cleanupStrapi, setupStrapi } from './harness'

// Fixture types (test/strapi/app/src/api/): `page` is site-scoped with a dynamic zone, `note` is
// site-scoped without one, `sketch` has a dynamic zone and no site.
const PAGE_UID = 'api::page.page'
const NOTE_UID = 'api::note.note'
const SKETCH_UID = 'api::sketch.sketch'
const PASSWORD = 'Password1234'

describe("Strapi's own Open preview button", () => {
  let strapi: Core.Strapi
  let base: string
  let token: string
  let pageId: string
  let noteId: string
  let sketchId: string

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const site = (await strapi.documents(SITE_UID as UID.ContentType).findFirst()) as {
      documentId: string
    }
    const page = await strapi.documents(PAGE_UID as UID.ContentType).create({
      data: { title: 'Landing', slug: 'landing', site: site.documentId } as never,
    })
    const note = await strapi.documents(NOTE_UID as UID.ContentType).create({
      data: { title: 'A note', site: site.documentId } as never,
    })
    const sketch = await strapi.documents(SKETCH_UID as UID.ContentType).create({
      data: { title: 'A sketch' } as never,
    })
    sketchId = sketch.documentId
    pageId = page.documentId
    noteId = note.documentId
    const role = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    await strapi.service('admin::user').create({
      email: 'admin@example.com',
      firstname: 'Admin',
      lastname: 'Test',
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
    })
    const login = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: PASSWORD }),
    })
    token = ((await login.json()) as { data: { token: string } }).data.token
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  const urlOf = (uid: string, query: string) =>
    fetch(`${base}/content-manager/preview/url/${uid}?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

  it('answers the preview page of an entry of a type with a site and a dynamic zone', async () => {
    const response = await urlOf(PAGE_UID, `documentId=${pageId}&locale=en&status=draft`)
    expect(response.status).toBe(200)
    const { data } = (await response.json()) as { data: { url: string } }
    expect(data.url).toBe(`/admin/plugins/micelio/preview/api%3A%3Apage.page/${pageId}?locale=en`)
  })

  it('answers nothing for a type without a dynamic zone, so Strapi shows no button', async () => {
    const response = await urlOf(NOTE_UID, `documentId=${noteId}&status=draft`)
    expect(response.status).toBe(204)
  })

  it('answers nothing for a type with a dynamic zone and no site', async () => {
    const response = await urlOf(SKETCH_UID, `documentId=${sketchId}&status=draft`)
    expect(response.status).toBe(204)
  })

  it('leaves out the locale when Strapi gives none', async () => {
    const url = strapi.config.get('admin.preview') as {
      config: { handler: (uid: string, params: object) => string | undefined }
    }
    expect(url.config.handler(PAGE_UID, { documentId: pageId })).toBe(
      `/admin/plugins/micelio/preview/api%3A%3Apage.page/${pageId}`
    )
  })

  it('leaves the preview configuration of the host alone', () => {
    const sets: unknown[] = []
    const hosted = { enabled: false }
    const strapiOf = (preview: unknown) =>
      ({
        config: {
          get: (key: string) => (key === 'admin.preview' ? preview : undefined),
          set: (_key: string, value: unknown) => sets.push(value),
        },
      }) as unknown as Core.Strapi

    registerPreviewShortcut(strapiOf(hosted))
    expect(sets).toEqual([])
    registerPreviewShortcut(strapiOf(undefined))
    expect(sets).toHaveLength(1)
  })

  describe('the URL of the page', () => {
    const zone = { type: 'dynamiczone' }
    const scoped = { micelio: { siteScoped: true } }
    const schemas: Record<string, object> = {
      'api::page.page': {
        kind: 'collectionType',
        attributes: { sections: zone },
        pluginOptions: scoped,
      },
      'api::sketch.sketch': { kind: 'collectionType', attributes: { sections: zone } },
      'api::home.home': {
        kind: 'singleType',
        attributes: { sections: zone },
        pluginOptions: scoped,
      },
    }
    const strapiOf = (adminUrl?: string) =>
      ({
        contentType: (uid: string) => schemas[uid],
        config: {
          get: (key: string, fallback?: unknown) =>
            key === 'admin.url' ? (adminUrl ?? fallback) : fallback,
        },
      }) as unknown as Core.Strapi

    it('keeps the path prefix of a server behind a proxy, as the browser sees the admin', () => {
      expect(
        previewPageUrl(strapiOf('https://example.com/cms/admin'), 'api::page.page', {
          documentId: 'abc',
        })
      ).toBe('https://example.com/cms/admin/plugins/micelio/preview/api%3A%3Apage.page/abc')
    })

    it('is the relative admin path when Strapi sets no URL of its own', () => {
      expect(
        previewPageUrl(strapiOf(), 'api::page.page', { documentId: 'abc', locale: 'es' })
      ).toBe('/admin/plugins/micelio/preview/api%3A%3Apage.page/abc?locale=es')
    })

    it('has none for a type without a site, a single type or an unknown type', () => {
      const strapi = strapiOf()
      expect(previewPageUrl(strapi, 'api::sketch.sketch', { documentId: 'abc' })).toBeUndefined()
      expect(previewPageUrl(strapi, 'api::home.home', { documentId: 'abc' })).toBeUndefined()
      expect(previewPageUrl(strapi, 'api::none.none', { documentId: 'abc' })).toBeUndefined()
    })
  })
})
