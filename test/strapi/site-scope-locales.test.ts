import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'

// A site-scoped, localised type with draft and publish and content API routes (test/strapi/app/src/api/page/).
const PAGE_UID = 'api::page.page' as UID.ContentType

interface Page {
  documentId: string
  title: string
  locale: string
}

describe('a new locale of a site-scoped document', () => {
  let strapi: Core.Strapi
  let base: string
  let token: string
  let defaultSite: string
  let otherSite: string
  let thirdSite: string

  const sites = () => strapi.documents(SITE_UID as UID.ContentType)
  const pages = () => strapi.documents(PAGE_UID)
  let counter = 0

  /** A page in `en` of the given site, with a slug of its own. */
  async function pageOf(site: string): Promise<string> {
    counter += 1
    const created = await pages().create({
      locale: 'en',
      data: { title: `Page ${counter}`, slug: `page-${counter}`, site } as never,
    })
    return created.documentId
  }

  /** What the Content Manager sends to add a locale: the form's data, `site` untouched. */
  function formData(slug: string, site?: unknown): never {
    const data: Record<string, unknown> = { title: `Título ${slug}`, slug }
    if (site !== undefined) data.site = site
    return data as never
  }

  /** The entry id of a site: its documentId would be looked up in the locale of the page. */
  async function entryId(site: string): Promise<number> {
    const row = (await strapi.db.query(SITE_UID).findOne({ where: { documentId: site } })) as {
      id: number
    }
    return row.id
  }

  async function siteOf(documentId: string, locale: string): Promise<string | undefined> {
    const row = (await pages().findOne({ documentId, locale, populate: ['site'] } as never)) as {
      site?: { documentId: string } | null
    } | null
    return row?.site?.documentId
  }

  async function read(path: string): Promise<Page[]> {
    const response = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(200)
    return ((await response.json()) as { data: Page[] }).data
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const created = (await strapi.service('admin::api-token').create({
      name: 'site-scope-locales-test',
      type: 'full-access',
      lifespan: null,
    })) as { accessKey: string }
    token = created.accessKey
    await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' })
    await strapi.plugin('i18n').service('locales').create({ code: 'fr', name: 'French (fr)' })

    defaultSite = (await sites().findFirst({ filters: { isDefault: true } }))!.documentId
    const another = async (slug: string): Promise<string> => {
      const site = await sites().create({
        data: {
          name: slug,
          slug,
          hosts: [`${slug}.test`],
          isDefault: false,
          defaultLocale: 'en',
          modules: {},
        },
      })
      return site.documentId
    }
    otherSite = await another('other')
    thirdSite = await another('third')
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  describe('added through the document service', () => {
    it('takes the site of its document when the form leaves the relation untouched', async () => {
      const documentId = await pageOf(otherSite)
      await pages().update({
        documentId,
        locale: 'es',
        data: formData('pagina-form', { connect: [], disconnect: [] }),
      })
      expect(await siteOf(documentId, 'es')).toBe(otherSite)

      // The content API of that site serves it once published; the default site does not.
      await pages().publish({ documentId, locale: 'es' })
      expect(await siteOf(documentId, 'es')).toBe(otherSite)
      const published = await pages().findOne({
        documentId,
        locale: 'es',
        status: 'published',
        populate: ['site'],
      } as never)
      expect((published as unknown as { site: { documentId: string } }).site.documentId).toBe(
        otherSite
      )
      const served = await read('/api/pages?site=other&locale=es')
      expect(served.map((page) => page.documentId)).toEqual([documentId])
      expect(await read('/api/pages?locale=es')).toEqual([])
    })

    it('takes the site of its document when the data names no site', async () => {
      const documentId = await pageOf(defaultSite)
      await pages().update({ documentId, locale: 'es', data: formData('pagina-absent') })
      expect(await siteOf(documentId, 'es')).toBe(defaultSite)
      await pages().publish({ documentId, locale: 'es' })
      const served = await read('/api/pages?locale=es')
      expect(served.map((page) => page.documentId)).toContain(documentId)
    })

    it('takes the site of its document in a request scoped to that site', async () => {
      const documentId = await pageOf(otherSite)
      const response = await fetch(`${base}/api/pages/${documentId}?site=other&locale=es`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { title: 'Título', slug: 'pagina-scoped' } }),
      })
      expect(response.status).toBe(200)
      expect(await siteOf(documentId, 'es')).toBe(otherSite)
    })

    it('takes the site of its document when the other rows are a draft and a published version', async () => {
      const documentId = await pageOf(otherSite)
      await pages().publish({ documentId, locale: 'en' })
      await pages().update({ documentId, locale: 'fr', data: formData('page-fr') })
      expect(await siteOf(documentId, 'fr')).toBe(otherSite)
    })

    it('refuses a new locale that names another site than its document, by entry id or documentId', async () => {
      const documentId = await pageOf(otherSite)
      const moves = [
        { connect: [{ id: await entryId(thirdSite) }], disconnect: [] },
        { connect: [{ documentId: thirdSite }] },
        thirdSite,
      ]
      for (const move of moves) {
        await expect(
          pages().update({ documentId, locale: 'es', data: formData('pagina-moved', move) })
        ).rejects.toThrow(/site must be the site of the other locales/)
      }
      expect(await pages().findOne({ documentId, locale: 'es' })).toBeNull()
    })

    it('takes the site of its document when it names that site', async () => {
      const documentId = await pageOf(otherSite)
      await pages().update({
        documentId,
        locale: 'es',
        data: formData('pagina-named', { connect: [{ id: await entryId(otherSite) }] }),
      })
      expect(await siteOf(documentId, 'es')).toBe(otherSite)
    })

    it('still refuses a removal of the site in the new locale', async () => {
      const documentId = await pageOf(otherSite)
      await expect(
        pages().update({
          documentId,
          locale: 'es',
          data: formData('pagina-removed', {
            connect: [],
            disconnect: [{ id: await entryId(otherSite) }],
          }),
        })
      ).rejects.toThrow(/site is required/)
      expect(await pages().findOne({ documentId, locale: 'es' })).toBeNull()
    })

    /** A document whose `en` and `es` rows name different sites, as a row saved before the guard. */
    async function splitDocument(): Promise<string> {
      const documentId = await pageOf(otherSite)
      await strapi.db.query(PAGE_UID).create({
        data: {
          title: 'Split',
          slug: `split-${documentId}`,
          locale: 'es',
          documentId,
          site: await entryId(thirdSite),
        },
      })
      return documentId
    }

    it('refuses the new locale of a document whose locales disagree on the site', async () => {
      const documentId = await splitDocument()
      await expect(
        pages().update({ documentId, locale: 'fr', data: formData('page-split-fr') })
      ).rejects.toThrow(/site is required/)
      expect(await pages().findOne({ documentId, locale: 'fr' })).toBeNull()
    })

    it('answers 404, not 400, to a scoped request for the new locale of another site document', async () => {
      const documentId = await splitDocument()
      const response = await fetch(`${base}/api/pages/${documentId}?site=default&locale=fr`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { title: 'Título', slug: 'pagina-oracle' } }),
      })
      expect(response.status).toBe(404)
    })

    it('refuses the new locale of a document none of whose rows has a site', async () => {
      // A row saved before the guard: the document service would refuse to create it.
      const row = (await strapi.db.query(PAGE_UID).create({
        data: { title: 'Orphan', slug: 'orphan', locale: 'en', documentId: 'orphan-document' },
      })) as { documentId: string }
      await expect(
        pages().update({
          documentId: row.documentId,
          locale: 'es',
          data: formData('orphan-es', { connect: [], disconnect: [] }),
        })
      ).rejects.toThrow(/site is required/)
    })

    it('does not touch an update of a locale that exists', async () => {
      const documentId = await pageOf(otherSite)
      await pages().update({ documentId, locale: 'es', data: formData('existing-es') })
      await pages().update({ documentId, locale: 'es', data: formData('existing-es-2') })
      expect(await siteOf(documentId, 'es')).toBe(otherSite)
    })

    it('keeps the site of a locale after its changes are discarded', async () => {
      const documentId = await pageOf(otherSite)
      await pages().update({ documentId, locale: 'es', data: formData('pagina-discard') })
      await pages().publish({ documentId, locale: 'es' })
      await pages().update({ documentId, locale: 'es', data: { title: 'Edited' } as never })
      await pages().discardDraft({ documentId, locale: 'es' })
      expect(await siteOf(documentId, 'es')).toBe(otherSite)

      await pages().publish({ documentId, locale: 'es' })
      const served = await read('/api/pages?site=other&locale=es')
      expect(served.map((page) => page.documentId)).toContain(documentId)
    })

    it('keeps the site of a locale published by an update, and of a clone', async () => {
      const documentId = await pageOf(otherSite)
      await pages().update({
        documentId,
        locale: 'es',
        status: 'published',
        data: formData('pagina-update-published'),
      })
      const published = (await strapi.db.query(PAGE_UID).findOne({
        where: { documentId, locale: 'es', publishedAt: { $notNull: true } },
        populate: ['site'],
      })) as { site?: { documentId: string } | null } | null
      expect(published?.site?.documentId).toBe(otherSite)

      const clone = await pages().clone({
        documentId,
        locale: 'es',
        data: { slug: 'pagina-clone' } as never,
      })
      expect(await siteOf(clone!.documentId, 'es')).toBe(otherSite)
    })

    it('keeps the site of the locales published with locale *', async () => {
      const documentId = await pageOf(otherSite)
      await pages().update({ documentId, locale: 'es', data: formData('pagina-star') })
      await pages().publish({ documentId, locale: '*' })
      const rows = (await strapi.db.query(PAGE_UID).findMany({
        where: { documentId, publishedAt: { $notNull: true } },
        populate: ['site'],
      })) as { locale: string; site?: { documentId: string } | null }[]
      expect(rows.map((row) => row.locale).sort()).toEqual(['en', 'es'])
      expect(rows.map((row) => row.site?.documentId)).toEqual([otherSite, otherSite])
      const served = await read('/api/pages?site=other&locale=es')
      expect(served.map((page) => page.documentId)).toContain(documentId)
    })

    it('refuses to move one locale of a document whose other locales stay on another site', async () => {
      const documentId = await pageOf(otherSite)
      await pages().update({ documentId, locale: 'es', data: formData('pagina-move') })
      await expect(
        pages().update({
          documentId,
          locale: 'es',
          data: { site: await entryId(thirdSite) } as never,
        })
      ).rejects.toThrow(/cannot change while other locales/)
      await expect(
        pages().update({ documentId, locale: 'es', data: { site: thirdSite } as never })
      ).rejects.toThrow(/cannot change while other locales/)
      expect(await siteOf(documentId, 'es')).toBe(otherSite)
    })

    it('moves a document of a single locale, and one whose other locales are on the new site', async () => {
      const single = await pageOf(otherSite)
      await pages().update({ documentId: single, locale: 'en', data: { site: thirdSite } as never })
      expect(await siteOf(single, 'en')).toBe(thirdSite)

      const split = await splitDocument()
      await pages().update({
        documentId: split,
        locale: 'en',
        data: { site: await entryId(thirdSite) } as never,
      })
      expect(await siteOf(split, 'en')).toBe(thirdSite)
    })

    it('answers nothing for a document that does not exist', async () => {
      const result = await pages().update({
        documentId: 'missingdocument',
        locale: 'es',
        data: formData('missing'),
      })
      expect(result).toBeNull()
    })
  })
})
