import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'

// A site-scoped fixture type of the test app (test/strapi/app/src/api/note/).
const NOTE_UID = 'api::note.note' as UID.ContentType

interface Note {
  documentId: string
  title: string
}

describe('site scoping', () => {
  let strapi: Core.Strapi
  let base: string
  let token: string
  let defaultSite: string
  let otherSite: string

  const sites = () => strapi.documents(SITE_UID as UID.ContentType)
  const notes = () => strapi.documents(NOTE_UID)

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    })
  }

  async function titles(path: string, init?: RequestInit): Promise<string[]> {
    const response = await request(path, init)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: Note[] }
    return body.data.map((note) => note.title).sort()
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const created = (await strapi.service('admin::api-token').create({
      name: 'site-scope-test',
      type: 'full-access',
      lifespan: null,
    })) as { accessKey: string }
    token = created.accessKey

    defaultSite = (await sites().findFirst({ filters: { isDefault: true } }))!.documentId
    otherSite = (
      await sites().create({
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
    await notes().create({ data: { title: 'default one', site: defaultSite } })
    await notes().create({ data: { title: 'other one', site: otherSite } })
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  describe('the helper', () => {
    it('makes a type that cannot be saved without a site', async () => {
      await expect(notes().create({ data: { title: 'orphan' } })).rejects.toThrow(
        /site is required/
      )
    })

    it('does not let an entry lose its site', async () => {
      const note = await notes().findFirst({ filters: { title: 'default one' } })
      await expect(
        notes().update({ documentId: note!.documentId, data: { site: null } })
      ).rejects.toThrow(/site is required/)
    })
  })

  describe('the content API', () => {
    it('answers the default site when the request names none', async () => {
      expect(await titles('/api/notes')).toEqual(['default one'])
    })

    it('answers the site the `site` parameter names', async () => {
      expect(await titles('/api/notes?site=other')).toEqual(['other one'])
    })

    it('answers the site that lists the host', async () => {
      // `fetch` drops a Host header it is given; `node:http` sends it.
      const body = await new Promise<string>((resolve, reject) => {
        const req = http.get(
          `${base}/api/notes`,
          { headers: { Host: 'other.test', Authorization: `Bearer ${token}` } },
          (res) => {
            let text = ''
            res.on('data', (chunk: Buffer) => (text += chunk.toString()))
            res.on('end', () => resolve(text))
          }
        )
        req.on('error', reject)
      })
      const { data } = JSON.parse(body) as { data: Note[] }
      expect(data.map((note) => note.title)).toEqual(['other one'])
    })

    it('answers unknownSite as a problem detail for a site that does not exist', async () => {
      const response = await request('/api/notes?site=missing')
      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/)
      expect(await response.json()).toEqual({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'There is no site "missing".',
        code: 'unknownSite',
      })
    })

    it("does not find another site's entry by its id", async () => {
      const note = await notes().findFirst({ filters: { title: 'other one' } })
      const response = await request(`/api/notes/${note!.documentId}`)
      expect(response.status).toBe(404)
    })

    it('gives a new entry the site of the request', async () => {
      const response = await request('/api/notes?site=other', {
        method: 'POST',
        body: JSON.stringify({ data: { title: 'posted' } }),
      })
      expect(response.status).toBe(201)
      const { data } = (await response.json()) as { data: Note }
      const saved = await notes().findOne({ documentId: data.documentId, populate: ['site'] })
      expect(saved).toMatchObject({ site: { documentId: otherSite } })
    })

    it("does not change or delete another site's entry", async () => {
      const note = await notes().findFirst({ filters: { title: 'default one' } })
      const update = await request(`/api/notes/${note!.documentId}?site=other`, {
        method: 'PUT',
        body: JSON.stringify({ data: { title: 'changed' } }),
      })
      expect(update.status).toBe(404)
      const remove = await request(`/api/notes/${note!.documentId}?site=other`, {
        method: 'DELETE',
      })
      expect(remove.status).toBe(404)
      expect(await notes().findOne({ documentId: note!.documentId })).toMatchObject({
        title: 'default one',
      })
    })
  })

  describe('the sites route', () => {
    it('lists the sites under an explicit prefix', async () => {
      const response = await request('/api/micelio/sites')
      expect(response.status).toBe(200)
      const { data } = (await response.json()) as { data: { slug: string }[] }
      expect(data.map((site) => site.slug).sort()).toEqual(['default', 'other'])
    })

    it('needs a token', async () => {
      const response = await fetch(`${base}/api/micelio/sites`)
      expect(response.status).toBe(401)
    })
  })

  describe('the sites', () => {
    it('stores host names in lower case', async () => {
      const site = await sites().update({
        documentId: otherSite,
        data: { hosts: ['Other.test', 'www.other.test'] },
      })
      expect(site).toMatchObject({ hosts: ['other.test', 'www.other.test'] })
    })

    it('rejects a host name with a scheme', async () => {
      await expect(
        sites().update({ documentId: otherSite, data: { hosts: ['https://other.test'] } })
      ).rejects.toThrow(/is not a host name/)
    })

    it('rejects a host name another site has', async () => {
      await sites().update({ documentId: defaultSite, data: { hosts: ['example.com'] } })
      await expect(
        sites().update({ documentId: otherSite, data: { hosts: ['example.com'] } })
      ).rejects.toThrow(/Another site already has the host "example.com"/)
    })

    it('keeps exactly one default site', async () => {
      await sites().update({ documentId: otherSite, data: { isDefault: true } })
      const defaults = await sites().findMany({ filters: { isDefault: true } })
      expect(defaults.map((site) => site.documentId)).toEqual([otherSite])

      await expect(
        sites().update({ documentId: otherSite, data: { isDefault: false } })
      ).rejects.toThrow(/Make another site the default instead/)
      await expect(sites().delete({ documentId: otherSite })).rejects.toThrow(
        /The default site cannot be deleted/
      )

      await sites().update({ documentId: defaultSite, data: { isDefault: true } })
      expect(await strapi.db.query(SITE_UID).count({ where: { isDefault: true } })).toBe(1)
    })
  })
})
