import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'
import { ARTICLE_POPULATE, PAGE_POPULATE } from '../fixtures/micelio-populate'

// The draft read with the `populate` the frontend sends for an article (`ARTICLE_POPULATE` in
// micelio, `server/lib/constants.ts`), on the fixture type `post` (test/strapi/app/src/api/post/):
// media, a component, a dynamic zone and relations, one of them to its own type. The API token
// holds what the distribution gives the frontend (docs/security.md of micelio: `find` on the
// content types it reads, the two preview routes) and nothing on the media library.
const POST_UID = 'api::post.post'
const LABEL_UID = 'api::label.label'
const PAGE_UID = 'api::page.page'
const PASSWORD = 'Password1234'
const ADMIN_ORIGIN = 'https://admin.example.com'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

interface Problem {
  status: number
  code: string
  detail: string
}

interface Entry {
  documentId: string
  title?: string
  name?: string
  cover?: { url: string; related?: unknown } | null
  seo?: { metaTitle?: string; metaImage?: { url: string } | null } | null
  blocks?: { __component: string; title?: string }[]
  tags?: { documentId: string; name: string }[]
  related?: Entry[]
  locale?: string
  publishedAt?: string | null
  localizations?: Entry[]
  site?: unknown
}

/** Flattens a query object into the bracket notation Strapi reads: `populate[cover][fields][0]=url`. */
function bracketed(value: unknown, prefix = ''): [string, string][] {
  if (typeof value !== 'object' || value === null) return [[prefix, String(value)]]
  return Object.entries(value).flatMap(([key, child]) =>
    bracketed(child, prefix === '' ? key : `${prefix}[${key}]`)
  )
}

describe('the draft read with the populate of the frontend', () => {
  let strapi: Core.Strapi
  let base: string
  let site: string
  let otherSite: string
  let apiToken: string
  let previewOnlyToken: string
  let grant: string
  let post: string
  let sibling: string
  let foreign: string
  let hidden: string
  let unpublished: string
  let tagHere: string
  let tagThere: string
  let serverFile: string
  let postsCreated = 0
  const documents = (uid: string) => strapi.documents(uid as UID.ContentType)

  async function createPost(data: Record<string, unknown>, onSite = site): Promise<string> {
    postsCreated += 1
    const created = await documents(POST_UID).create({
      data: { title: `Post ${postsCreated}`, site: onSite, ...data },
    } as never)
    return created.documentId
  }

  async function upload(name: string): Promise<{ id: number; url: string }> {
    const filepath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'micelio-populate-')), name)
    fs.writeFileSync(filepath, PNG)
    const [file] = (await strapi
      .plugin('upload')
      .service('upload')
      .upload({
        data: { fileInfo: { name } },
        files: { filepath, originalFilename: name, mimetype: 'image/png', size: PNG.length },
      })) as { id: number; url: string }[]
    return file!
  }

  /** An admin user, a preview token, the exchange with the frontend's API token: a grant. */
  async function grantFor(documentId: string, uid: string = POST_UID): Promise<string> {
    const login = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'populate-admin@example.com', password: PASSWORD }),
    })
    const admin = ((await login.json()) as { data: { token: string } }).data.token
    const asked = await fetch(`${base}/micelio/preview/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin}`,
        Origin: ADMIN_ORIGIN,
      },
      body: JSON.stringify({ uid, documentId }),
    })
    expect(asked.status).toBe(200)
    const url = ((await asked.json()) as { data: { url: string } }).data.url
    const exchanged = await fetch(`${base}/api/micelio/preview/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ token: new URL(url).searchParams.get('token') }),
    })
    expect(exchanged.status).toBe(200)
    return ((await exchanged.json()) as { data: { grant: string } }).data.grant
  }

  /** The draft route as the frontend calls it: its API token, the grant and a `populate`. */
  function draftOf(
    query: Record<string, unknown>,
    documentId = post,
    key = apiToken
  ): Promise<Response> {
    const search = new URLSearchParams(bracketed({ documentId, ...query })).toString()
    return fetch(`${base}/api/micelio/preview/draft?${search}`, {
      headers: { Authorization: `Bearer ${key}`, 'X-Micelio-Preview-Grant': grant },
    })
  }

  async function dataOf(response: Response): Promise<Entry> {
    expect(response.status).toBe(200)
    return ((await response.json()) as { data: Entry }).data
  }

  // The shape of `ARTICLE_POPULATE`, on the fields of the fixture.
  const frontend = {
    cover: { fields: ['url'] },
    seo: { populate: { metaImage: { fields: ['url'] } } },
    tags: { fields: ['name'] },
    blocks: { on: { 'shared.quote': true, 'fixture.link': true } },
    // `author: { fields: ['name'], populate: { avatar: IMAGE } }`: a relation with a media of its own.
    related: { fields: ['title'], populate: { cover: { fields: ['url'] } } },
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const sites = documents(SITE_UID)
    site = (await sites.findFirst({}))!.documentId
    await sites.update({ documentId: site, data: { url: 'https://example.com:8443' } } as never)
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
      } as never)
    ).documentId
    const superAdmin = (await strapi.db
      .query('admin::role')
      .findOne({ where: { code: 'strapi-super-admin' } })) as { id: number }
    await strapi.service('admin::user').create({
      email: 'populate-admin@example.com',
      firstname: 'Populate',
      lastname: 'Test',
      password: PASSWORD,
      roles: [superAdmin.id],
      isActive: true,
    })
    const previewPermissions = ['plugin::micelio.preview.exchange', 'plugin::micelio.preview.draft']
    const tokenWith = async (name: string, permissions: string[]) =>
      (
        (await strapi.service('admin::api-token').create({
          name,
          type: 'custom',
          lifespan: null,
          permissions: [...previewPermissions, ...permissions],
        })) as { accessKey: string }
      ).accessKey
    apiToken = await tokenWith('frontend', [
      `${POST_UID}.find`,
      `${POST_UID}.findOne`,
      `${LABEL_UID}.find`,
      `${LABEL_UID}.findOne`,
    ])
    previewOnlyToken = await tokenWith('preview-only', [])

    const cover = await upload('cover.png')
    const poster = await upload('poster.png')
    serverFile = cover.url
    tagHere = (await documents(LABEL_UID).create({ data: { name: 'Here', site } } as never))
      .documentId
    tagThere = (
      await documents(LABEL_UID).create({ data: { name: 'There', site: otherSite } } as never)
    ).documentId
    sibling = await createPost({ title: 'Sibling', cover: poster.id })
    foreign = await createPost({ title: 'Foreign' }, otherSite)
    hidden = await createPost({ title: 'Hidden' })
    unpublished = await createPost({ title: 'Never published' })
    // `hidden` is related to the sibling only: no relation of the document being read names it.
    await documents(POST_UID).update({
      documentId: sibling,
      data: { related: [hidden] },
    } as never)
    await documents(POST_UID).publish({ documentId: sibling })
    await documents(POST_UID).publish({ documentId: foreign })
    // The sibling's draft moves on after it was published: the grant must not serve this one.
    await documents(POST_UID).update({
      documentId: sibling,
      data: { title: 'Sibling, edited' },
    } as never)
    post = await createPost({
      title: 'The draft',
      cover: cover.id,
      seo: { metaTitle: 'Meta', metaImage: poster.id },
      blocks: [
        { __component: 'shared.quote', title: 'Quote', body: 'Said' },
        { __component: 'fixture.link', label: 'Link' },
      ],
      tags: [tagHere, tagThere],
      related: [sibling, foreign, unpublished],
    })
    grant = await grantFor(post)
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('serves the populate of each kind of relation with a token that cannot read the media library', async () => {
    const data = await dataOf(await draftOf({ populate: frontend }))
    expect(data).toMatchObject({ documentId: post, title: 'The draft' })
    expect(data.cover?.url).toBe(serverFile)
    expect(data.seo).toMatchObject({ metaTitle: 'Meta' })
    expect(data.seo?.metaImage?.url).toMatch(/poster/)
    expect(data.blocks?.map((block) => block.__component)).toEqual(['shared.quote', 'fixture.link'])
    expect(data.tags?.map((tag) => tag.name)).toEqual(['Here'])
    expect(data.related?.map((entry) => entry.title)).toEqual(['Sibling'])
    expect(data.related?.[0]?.cover?.url).toMatch(/poster/)
  })

  it('serves a related entry as published: not its newer draft, not one that was never published', async () => {
    const data = await dataOf(await draftOf({ populate: { related: true, tags: true } }))
    expect(data.related?.map((entry) => entry.documentId)).toEqual([sibling])
    expect(data.related?.[0]?.title).toBe('Sibling')
    expect(JSON.stringify(data)).not.toContain('edited')
    expect(JSON.stringify(data)).not.toContain(unpublished)
    // A type without draft and publish has one version, which is the published one.
    expect(data.tags?.map((tag) => tag.name)).toEqual(['Here'])
  })

  it('still serves populate=*, no populate and a list of names', async () => {
    expect((await dataOf(await draftOf({ populate: '*' }))).cover).toBeTruthy()
    expect((await dataOf(await draftOf({}))).cover).toBeUndefined()
    const listed = await dataOf(await draftOf({ populate: ['cover', 'tags'] }))
    expect(listed.cover?.url).toBe(serverFile)
    expect(listed.tags).toBeTruthy()
  })

  it('does not widen the token: what it may not find stays out of the answer', async () => {
    const answer = await draftOf({ populate: frontend }, post, previewOnlyToken)
    const data = await dataOf(answer)
    expect(data.documentId).toBe(post)
    expect(data.tags).toBeUndefined()
    expect(data.related).toBeUndefined()
    expect(data.blocks).toBeTruthy()
  })

  describe('reaches nothing the grant does not name', () => {
    it('leaves out the entries of another site', async () => {
      const related = await dataOf(await draftOf({ populate: { related: true, tags: true } }))
      const tags = await dataOf(await draftOf({ populate: ['tags'] }))
      const all = await dataOf(await draftOf({ populate: '*' }))
      expect(related.related?.map((entry) => entry.documentId)).toEqual([sibling])
      expect(tags.tags?.map((tag) => tag.documentId)).toEqual([tagHere])
      expect(all.related?.map((entry) => entry.documentId)).toEqual([sibling])
      for (const answer of [related, tags, all]) {
        expect(JSON.stringify(answer)).not.toContain(foreign)
        expect(JSON.stringify(answer)).not.toContain(tagThere)
      }
    })

    it('does not serve another document by its id', async () => {
      const answer = await draftOf({ populate: '*' }, sibling)
      expect(answer.status).toBe(404)
      expect((await answer.json()) as Problem).toMatchObject({ code: 'previewRefused' })
    })
  })

  describe('answers 400 previewRequestInvalid for a query it cannot serve', () => {
    const invalid: [string, Record<string, unknown>][] = [
      ['an unknown populate', { populate: { nothing: true } }],
      ['an unknown nested populate', { populate: { related: { populate: { nothing: true } } } }],
      ['an unknown populate in a list', { populate: ['cover', 'nothing'] }],
      ['a populate that is not a populate', { populate: 7 }],
      ['a populate of a scalar', { populate: { title: true } }],
      ['a populate that mixes * and names', { populate: ['*', 'cover'] }],
      ['a populate named twice', { populate: ['tags', 'tags.name'] }],
      ['the admin user who created the draft', { populate: ['createdBy'] }],
      ['the admin user who updated the draft', { populate: { updatedBy: true } }],
      [
        'an unknown dynamic zone fragment',
        { populate: { blocks: { on: { 'shared.nothing': true } } } },
      ],
      ['an unknown field of a relation', { populate: { tags: { fields: ['nothing'] } } }],
      ['a relation as a field', { populate: { related: { fields: ['tags'] } } }],
      // I2: nothing that tests an entry the answer leaves out.
      ['fields', { fields: ['title'] }],
      ['filters', { filters: { title: { $eq: 'x' } } }],
      ['filters through a relation', { filters: { tags: { name: { $startsWith: 'T' } } } }],
      ['filters in a populate', { populate: { related: { filters: { title: 'x' } } } }],
      ['sort', { sort: 'title:asc' }],
      ['sort in a populate', { populate: { tags: { sort: 'name:asc' } } }],
      ['pagination', { pagination: { pageSize: 1 } }],
      ['pagination in a populate', { populate: { tags: { pagination: { limit: 1 } } } }],
      ['count in a populate', { populate: { tags: { count: true } } }],
      ['status', { status: 'published' }],
      ['an unknown key', { nothing: 'x' }],
      // I1: what Strapi's own layers answered 500 or a bare 400 to.
      ['an $and that is not a list', { filters: { $and: 7 } }],
      ['an $and of strings', { filters: { $and: ['x'] } }],
      ['an $or of strings', { filters: { $or: ['x'] } }],
      ['a $not that is not an object', { filters: { $not: 'x' } }],
      // B1: a populate goes one level through a relation.
      ['a relation under a relation', { populate: { related: { populate: { related: true } } } }],
      ['a relation under a relation by path', { populate: ['related.related'] }],
      ['a relation under a relation as *', { populate: { related: { populate: '*' } } }],
      ['a component under a relation', { populate: { related: { populate: { seo: true } } } }],
      ['a dynamic zone under a relation', { populate: { related: { populate: ['blocks'] } } }],
      ['a populate of the relation to itself', { populate: { related: { populate: ['tags'] } } }],
      ['an `on` under a relation', { populate: { related: { on: { 'shared.quote': true } } } }],
      // B2: nothing under a media attribute but its fields, and so never the file's `related`.
      ['the related entries of a file', { populate: { cover: { populate: ['related'] } } }],
      ['the related entries of a file by path', { populate: ['cover.related'] }],
      ['a populate of a file as *', { populate: { cover: { populate: '*' } } }],
      [
        'the related entries of the media of a component',
        { populate: { seo: { populate: { metaImage: { populate: ['related'] } } } } },
      ],
      [
        'the related entries of the media of a related entry',
        { populate: { related: { populate: { cover: { populate: ['related'] } } } } },
      ],
      ['a filter on a file', { populate: { cover: { filters: { name: 'x' } } } }],
    ]
    it.each(invalid)('for %s', async (_name, query) => {
      const response = await draftOf(query)
      expect(response.status).toBe(400)
      expect(response.headers.get('content-type')).toContain('application/problem+json')
      expect((await response.json()) as Problem).toMatchObject({
        status: 400,
        code: 'previewRequestInvalid',
      })
    })

    it('does not leak what it refuses', async () => {
      const response = await draftOf({ populate: { cover: { populate: ['related'] } } })
      const text = await response.text()
      for (const secret of [hidden, foreign, unpublished, 'populate-admin@example.com']) {
        expect(text).not.toContain(secret)
      }
    })
  })

  describe('serves a media attribute under a relation with its fields only', () => {
    it('serves the fields of the file the related entry holds', async () => {
      const data = await dataOf(
        await draftOf({
          populate: { related: { populate: { cover: { fields: ['url', 'name'] } } } },
        })
      )
      const cover = data.related?.[0]?.cover as Record<string, unknown>
      expect(cover).toMatchObject({ name: 'poster.png' })
      expect(cover.url).toMatch(/poster/)
      expect(cover).not.toHaveProperty('related')
      expect(cover).not.toHaveProperty('width')
    })

    it('never carries the entries a file belongs to', async () => {
      for (const populate of [{ cover: true, seo: { populate: { metaImage: true } } }, '*']) {
        const data = await dataOf(await draftOf({ populate }))
        expect(data.cover).toBeTruthy()
        expect(data.cover).not.toHaveProperty('related')
        if (typeof populate !== 'string') {
          expect(data.seo?.metaImage?.url).toBeTruthy()
          expect(data.seo?.metaImage).not.toHaveProperty('related')
        }
      }
    })
  })

  describe('serves the localizations the frontend asks for', () => {
    // Both constants of the frontend ask for `localizations` with these fields; `slug` and `locale`
    // come from `PAGE_POPULATE`, `publishedAt` from `ARTICLE_POPULATE`. The page fixture is
    // localised with draft and publish, like the `article` and `page` of micelio-cms.
    const localizations = {
      fields: [
        ...new Set([
          ...ARTICLE_POPULATE.localizations.fields,
          ...PAGE_POPULATE.localizations.fields,
        ]),
      ],
    }
    let page: string
    let pageToken: string

    beforeAll(async () => {
      await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' })
      await strapi.plugin('i18n').service('locales').create({ code: 'fr', name: 'French (fr)' })
      const pages = documents(PAGE_UID)
      const created = await pages.create({
        locale: 'en',
        data: { title: 'Home', slug: 'home', site },
      } as never)
      page = created.documentId
      // `es` is published and its draft moves on; `fr` is a draft that was never published.
      await pages.update({
        documentId: page,
        locale: 'es',
        data: { title: 'Inicio', slug: 'inicio' },
      } as never)
      await pages.publish({ documentId: page, locale: 'es' })
      await pages.update({
        documentId: page,
        locale: 'es',
        data: { title: 'Inicio, editado' },
      } as never)
      await pages.update({
        documentId: page,
        locale: 'fr',
        data: { title: 'Accueil', slug: 'accueil' },
      } as never)
      // The site is not localised, but a locale made by an update starts without one (the relation
      // would look for the site in that locale), and the draft read leaves out an entry whose site
      // it cannot tell: give every row of the document its site.
      const siteRow = (await strapi.db
        .query(SITE_UID)
        .findOne({ where: { documentId: site } })) as {
        id: number
      }
      const rows = (await strapi.db.query(PAGE_UID).findMany({ where: { documentId: page } })) as {
        id: number
      }[]
      for (const { id } of rows) {
        await strapi.db.query(PAGE_UID).update({ where: { id }, data: { site: siteRow.id } })
      }
      pageToken = (
        (await strapi.service('admin::api-token').create({
          name: 'frontend-pages',
          type: 'custom',
          lifespan: null,
          permissions: [
            'plugin::micelio.preview.exchange',
            'plugin::micelio.preview.draft',
            `${PAGE_UID}.find`,
            `${PAGE_UID}.findOne`,
          ],
        })) as { accessKey: string }
      ).accessKey
    })

    it('serves another locale as published, with its publishedAt, and leaves out one never published', async () => {
      const pageGrant = await grantFor(page, PAGE_UID)
      const search = new URLSearchParams(
        bracketed({ documentId: page, locale: 'en', populate: { localizations } })
      ).toString()
      const response = await fetch(`${base}/api/micelio/preview/draft?${search}`, {
        headers: { Authorization: `Bearer ${pageToken}`, 'X-Micelio-Preview-Grant': pageGrant },
      })
      const data = await dataOf(response)
      expect(data).toMatchObject({ documentId: page, title: 'Home', locale: 'en' })
      expect(data.localizations).toHaveLength(1)
      expect(data.localizations?.[0]).toMatchObject({ locale: 'es', slug: 'inicio' })
      expect(typeof data.localizations?.[0]?.publishedAt).toBe('string')
      expect(JSON.stringify(data)).not.toContain('accueil')
      expect(JSON.stringify(data)).not.toContain('editado')
    })
  })
})
