import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import type { EditorialState } from '../../server/src/constants/editorial'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'

// A fixture type made with `withSiteScope` and `withEditorial` (test/strapi/app/src/api/article/).
const ARTICLE_UID = 'api::article.article' as UID.ContentType
// The same in several locales (test/strapi/app/src/api/essay/).
const ESSAY_UID = 'api::essay.essay' as UID.ContentType
const PASSWORD = 'Password1234'

type Role = 'strapi-super-admin' | 'strapi-editor' | 'strapi-author'

interface Problem {
  status: number
  code: string
}

describe('editorial transitions', () => {
  let strapi: Core.Strapi
  let base: string
  let site: string
  const tokens = {} as Record<Role, string>
  const userIds = {} as Record<Role, number>

  const articles = () => strapi.documents(ARTICLE_UID)

  async function login(role: Role): Promise<void> {
    const roleRow = (await strapi.db.query('admin::role').findOne({ where: { code: role } })) as {
      id: number
    }
    const email = `${role}@example.com`
    const user = (await strapi.service('admin::user').create({
      email,
      firstname: role,
      lastname: 'Test',
      password: PASSWORD,
      roles: [roleRow.id],
      isActive: true,
    })) as { id: number }
    userIds[role] = user.id
    const response = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    tokens[role] = ((await response.json()) as { data: { token: string } }).data.token
  }

  async function adminRequest(role: Role, path: string, body?: unknown): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[role]}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  function move(role: Role, documentId: string, to: EditorialState, publishAt?: string) {
    return adminRequest(role, '/micelio/transitions', {
      uid: ARTICLE_UID,
      documentId,
      to,
      publishAt,
    })
  }

  /** A new article created by `owner` through the Content Manager, then moved to `state`. */
  async function articleIn(state: EditorialState, owner: Role = 'strapi-author'): Promise<string> {
    const created = await adminRequest(owner, `/content-manager/collection-types/${ARTICLE_UID}`, {
      title: `${state} article`,
      site,
    })
    expect(created.status).toBe(201)
    const { data } = (await created.json()) as { data: { documentId: string } }
    const path: Record<EditorialState, [Role, EditorialState][]> = {
      draft: [],
      in_review: [['strapi-author', 'in_review']],
      published: [
        ['strapi-author', 'in_review'],
        ['strapi-editor', 'published'],
      ],
      scheduled: [['strapi-editor', 'scheduled']],
    }
    for (const [role, to] of path[state]) {
      const publishAt = to === 'scheduled' ? inAnHour() : undefined
      expect((await move(role, data.documentId, to, publishAt)).status).toBe(200)
    }
    return data.documentId
  }

  async function stateOf(documentId: string): Promise<{ state?: string; published: boolean }> {
    const draft = (await articles().findOne({
      documentId,
      status: 'draft',
      populate: ['editorial'],
    } as never)) as unknown as { editorial?: { state?: string } } | null
    const published = await articles().findOne({ documentId, status: 'published' } as never)
    return { state: draft?.editorial?.state, published: published !== null }
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    site = (await strapi.documents(SITE_UID as UID.ContentType).findFirst({}))!.documentId
    for (const role of ['strapi-super-admin', 'strapi-editor', 'strapi-author'] as const) {
      await login(role)
    }
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  describe('with the default policy', () => {
    it.each<[EditorialState, EditorialState, Role, boolean]>([
      ['draft', 'in_review', 'strapi-author', false],
      ['in_review', 'draft', 'strapi-author', false],
      ['in_review', 'draft', 'strapi-editor', false],
      ['in_review', 'published', 'strapi-editor', true],
      ['in_review', 'published', 'strapi-super-admin', true],
      ['draft', 'scheduled', 'strapi-editor', false],
      ['scheduled', 'draft', 'strapi-editor', false],
      ['published', 'draft', 'strapi-editor', false],
    ])('lets %s -> %s by %s, published afterwards: %s', async (from, to, role, published) => {
      const documentId = await articleIn(from)
      const response = await move(role, documentId, to, to === 'scheduled' ? inAnHour() : undefined)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ data: { documentId, from, to, site } })
      expect(await stateOf(documentId)).toEqual({ state: to, published })
    })

    it.each<[EditorialState, EditorialState, Role]>([
      ['in_review', 'published', 'strapi-author'],
      ['draft', 'scheduled', 'strapi-author'],
      ['scheduled', 'draft', 'strapi-author'],
      ['published', 'draft', 'strapi-author'],
      ['scheduled', 'published', 'strapi-editor'],
      ['scheduled', 'published', 'strapi-super-admin'],
    ])('forbids %s -> %s by %s with editorialTransitionForbidden', async (from, to, role) => {
      const documentId = await articleIn(from)
      const before = await stateOf(documentId)
      const response = await move(role, documentId, to)
      expect(response.status).toBe(403)
      expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/)
      expect(await response.json()).toMatchObject({
        status: 403,
        code: 'editorialTransitionForbidden',
      })
      expect(await stateOf(documentId)).toEqual(before)
    })

    it.each<[EditorialState, EditorialState]>([
      ['draft', 'published'],
      ['draft', 'draft'],
      ['in_review', 'scheduled'],
      ['in_review', 'in_review'],
      ['scheduled', 'in_review'],
      ['published', 'in_review'],
      ['published', 'scheduled'],
    ])(
      'refuses %s -> %s, which does not exist, with editorialTransitionInvalid',
      async (from, to) => {
        const documentId = await articleIn(from)
        const response = await move('strapi-super-admin', documentId, to, inAnHour())
        expect(response.status).toBe(409)
        expect((await response.json()) as Problem).toMatchObject({
          code: 'editorialTransitionInvalid',
        })
      }
    )

    it("does not let an author move another author's entry", async () => {
      const documentId = await articleIn('draft', 'strapi-editor')
      const response = await move('strapi-author', documentId, 'in_review')
      expect(response.status).toBe(403)
    })
  })

  describe('the transition record', () => {
    it('records who reviewed and who published, and when to publish', async () => {
      const documentId = await articleIn('in_review')
      await move('strapi-editor', documentId, 'published')
      const published = (await articles().findOne({
        documentId,
        status: 'published',
        populate: { editorial: { populate: ['reviewedBy', 'publishedBy'] } },
      } as never)) as unknown as {
        editorial: { reviewedBy: { id: number }; publishedBy: { id: number } }
      }
      expect(published.editorial.reviewedBy.id).toBe(userIds['strapi-editor'])
      expect(published.editorial.publishedBy.id).toBe(userIds['strapi-editor'])

      const scheduled = await articleIn('draft')
      const at = inAnHour()
      await move('strapi-editor', scheduled, 'scheduled', at)
      const draft = (await articles().findOne({
        documentId: scheduled,
        populate: ['editorial'],
      } as never)) as unknown as { editorial: { publishAt: string } }
      expect(new Date(draft.editorial.publishAt).toISOString()).toBe(at)
    })

    it('refuses to schedule without a future publishAt', async () => {
      const documentId = await articleIn('draft')
      for (const publishAt of [undefined, new Date(Date.now() - 1000).toISOString(), 'soon']) {
        const response = await move('strapi-editor', documentId, 'scheduled', publishAt)
        expect(response.status).toBe(400)
        expect((await response.json()) as Problem).toMatchObject({
          code: 'editorialPublishAtInvalid',
        })
      }
    })

    it('answers editorialEntryNotFound and editorialRequestInvalid', async () => {
      const missing = await move('strapi-editor', 'no-such-document', 'in_review')
      expect(missing.status).toBe(404)
      expect((await missing.json()) as Problem).toMatchObject({ code: 'editorialEntryNotFound' })
      const invalid = await adminRequest('strapi-editor', '/micelio/transitions', { to: 'nowhere' })
      expect(invalid.status).toBe(400)
      expect((await invalid.json()) as Problem).toMatchObject({ code: 'editorialRequestInvalid' })
    })

    it('needs an admin user', async () => {
      const response = await fetch(`${base}/micelio/transitions`, { method: 'POST' })
      expect(response.status).toBe(401)
    })
  })

  describe("a site's policy", () => {
    it('replaces the default for the transitions it lists', async () => {
      await strapi.documents(SITE_UID as UID.ContentType).update({
        documentId: site,
        data: { editorialPolicy: { 'draft->in_review': ['strapi-editor'] } },
      })
      try {
        const documentId = await articleIn('draft')
        expect((await move('strapi-author', documentId, 'in_review')).status).toBe(403)
        expect((await move('strapi-editor', documentId, 'in_review')).status).toBe(200)
      } finally {
        await strapi.documents(SITE_UID as UID.ContentType).update({
          documentId: site,
          data: { editorialPolicy: null },
        })
      }
    })

    it('is checked when saved', async () => {
      await expect(
        strapi.documents(SITE_UID as UID.ContentType).update({
          documentId: site,
          data: { editorialPolicy: { 'scheduled->published': ['strapi-editor'] } },
        })
      ).rejects.toThrow(/is not a transition a user performs/)
    })
  })

  describe('every other route to publishedAt', () => {
    it('is closed in the Content Manager', async () => {
      const documentId = await articleIn('in_review')
      const response = await adminRequest(
        'strapi-super-admin',
        `/content-manager/collection-types/${ARTICLE_UID}/${documentId}/actions/publish`,
        {}
      )
      // The guard refuses it; the admin API answers a plain "Forbidden" whatever the message.
      expect(response.status).toBe(403)
      expect(await stateOf(documentId)).toEqual({ state: 'in_review', published: false })
    })

    it('is closed in the document service', async () => {
      const documentId = await articleIn('in_review')
      await expect(articles().publish({ documentId } as never)).rejects.toThrow(
        /published through the editorial transitions/
      )
      const published = await articleIn('published')
      await expect(articles().unpublish({ documentId: published } as never)).rejects.toThrow(
        /published through the editorial transitions/
      )
      await expect(
        articles().create({ data: { title: 'direct', site }, status: 'published' } as never)
      ).rejects.toThrow(/published through the editorial transitions/)
      expect(await stateOf(published)).toEqual({ state: 'published', published: true })
    })

    it('keeps the editorial state out of a plain update', async () => {
      const documentId = await articleIn('in_review')
      await expect(
        articles().update({ documentId, data: { editorial: { state: 'published' } } } as never)
      ).rejects.toThrow(/changes only through a transition/)
      await articles().update({
        documentId,
        data: { title: 'renamed', editorial: { state: 'in_review' } },
      } as never)
      expect(await stateOf(documentId)).toEqual({ state: 'in_review', published: false })
    })

    it('starts a new entry in draft', async () => {
      await expect(
        articles().create({
          data: { title: 'x', site, editorial: { state: 'published' } },
        } as never)
      ).rejects.toThrow(/starts in the draft editorial state/)
      const created = await articles().create({ data: { title: 'y', site } } as never)
      expect(await stateOf(created.documentId)).toEqual({ state: 'draft', published: false })
    })
  })

  it('keeps a state per locale, as Strapi keeps a published version per locale', async () => {
    const essays = strapi.documents(ESSAY_UID)
    await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' })
    const { documentId } = await essays.create({
      locale: 'en',
      data: { title: 'Essay', site },
    } as never)
    for (const to of ['in_review', 'published']) {
      const response = await adminRequest('strapi-super-admin', '/micelio/transitions', {
        uid: ESSAY_UID,
        documentId,
        locale: 'en',
        to,
      })
      expect(response.status).toBe(200)
    }
    // The other locale is created after the first is published: it starts as a draft of its own.
    await essays.update({ documentId, locale: 'es', data: { title: 'Ensayo' } } as never)
    const stateIn = async (locale: string) => {
      const draft = (await essays.findOne({
        documentId,
        locale,
        populate: ['editorial'],
      } as never)) as unknown as { editorial?: { state?: string } | null }
      const published = await essays.findOne({ documentId, locale, status: 'published' } as never)
      return { state: draft.editorial?.state ?? 'draft', published: published !== null }
    }
    expect(await stateIn('en')).toEqual({ state: 'published', published: true })
    expect(await stateIn('es')).toEqual({ state: 'draft', published: false })
  })

  it('keeps the admin users out of the content API', async () => {
    const documentId = await articleIn('published')
    const token = (await strapi.service('admin::api-token').create({
      name: 'editorial-test',
      type: 'read-only',
      lifespan: null,
    })) as { accessKey: string }
    const response = await fetch(
      `${base}/api/articles/${documentId}?populate[editorial][populate]=*`,
      { headers: { Authorization: `Bearer ${token.accessKey}` } }
    )
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('"state":"published"')
    expect(text).not.toMatch(/@example\.com|password/)
  })
})

function inAnHour(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString()
}
