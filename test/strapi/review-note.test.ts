import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { REVIEW_READ_PERMISSION } from '../../server/src/constants/editorial'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'

const ARTICLE = 'api::article.article' as UID.ContentType
const PASSWORD = 'Password1234'

interface Listed {
  documentId: string | null
  name: string
  entries: { uid: string; documentId: string; title: string; note: string | null }[]
}

// The note of a transition (issue #57): the editor's for the reviewer, the reviewer's when they send
// the page back, stored in the editorial component until the next transition. And the In review list
// (`GET /micelio/review`) the reviewer works from.
describe('the note of a review and the In review list', () => {
  let strapi: Core.Strapi
  let base: string
  let site: string
  const tokens: Record<string, string> = {}

  const articles = () => strapi.documents(ARTICLE)

  const roleId = async (code: string): Promise<number> =>
    ((await strapi.db.query('admin::role').findOne({ where: { code } })) as { id: number }).id

  async function login(email: string, roleCode: string): Promise<string> {
    const role = { id: await roleId(roleCode) }
    await strapi.service('admin::user').create({
      email,
      firstname: 'Note',
      lastname: 'Test',
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
    })
    const response = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    return ((await response.json()) as { data: { token: string } }).data.token
  }

  function request(role: string, path: string, body?: unknown) {
    return fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[role]}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  const move = (role: string, documentId: string, to: string, note?: string) =>
    request(role, '/micelio/transitions', { uid: ARTICLE, documentId, to, note })

  async function noteOf(documentId: string): Promise<{ state: string; note: string | null }> {
    const draft = (await articles().findOne({
      documentId,
      status: 'draft',
      populate: ['editorial'],
    } as never)) as unknown as { editorial: { state: string; note: string | null } }
    return { state: draft.editorial.state, note: draft.editorial.note }
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    site = (await strapi.documents(SITE_UID as UID.ContentType).findFirst({}))!.documentId
    tokens.admin = await login('note-admin@example.com', 'strapi-super-admin')
    tokens.author = await login('note-author@example.com', 'strapi-author')
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('sending back keeps the note', async () => {
    const { documentId } = await articles().create({ data: { title: 'Essay', site } } as never)
    expect((await move('admin', documentId, 'in_review', 'The intro is new')).status).toBe(200)
    expect(await noteOf(documentId)).toEqual({ state: 'in_review', note: 'The intro is new' })

    const listed = (await (await request('admin', '/micelio/review')).json()) as { data: Listed[] }
    const entry = listed.data
      .find((group) => group.documentId === site)
      ?.entries.find((candidate) => candidate.documentId === documentId)
    expect(entry).toMatchObject({ uid: ARTICLE, title: 'Essay', note: 'The intro is new' })

    expect((await move('admin', documentId, 'draft', '  Shorten the second part  ')).status).toBe(
      200
    )
    expect(await noteOf(documentId)).toEqual({ state: 'draft', note: 'Shorten the second part' })
    // It stays through an edit, which is what the editor does with it.
    await articles().update({ documentId, data: { title: 'Essay, shorter' } } as never)
    expect(await noteOf(documentId)).toEqual({ state: 'draft', note: 'Shorten the second part' })
    // The next transition carries its own note, or none.
    expect((await move('admin', documentId, 'in_review')).status).toBe(200)
    expect(await noteOf(documentId)).toEqual({ state: 'in_review', note: null })
  })

  it('refuses a note longer than 1000 characters, and writes nothing', async () => {
    const { documentId } = await articles().create({ data: { title: 'Long', site } } as never)
    const response = await move('admin', documentId, 'in_review', 'x'.repeat(1001))
    expect(response.status).toBe(400)
    expect(((await response.json()) as { code: string }).code).toBe('editorialRequestInvalid')
    await expect(
      strapi
        .plugin('micelio')
        .service('transitions')
        .perform({
          uid: ARTICLE,
          documentId,
          to: 'in_review',
          note: 'y'.repeat(1001),
          actor: { kind: 'system' },
        })
    ).rejects.toMatchObject({ code: 'editorialRequestInvalid' })
    expect(await noteOf(documentId)).toEqual({ state: 'draft', note: null })
  })

  it('refuses a note or a dry run of the wrong type', async () => {
    const { documentId } = await articles().create({ data: { title: 'Typed', site } } as never)
    for (const extra of [{ note: 5 }, { dryRun: 'yes' }]) {
      const response = await request('admin', '/micelio/transitions', {
        uid: ARTICLE,
        documentId,
        to: 'in_review',
        ...extra,
      })
      expect(response.status, JSON.stringify(extra)).toBe(400)
      expect(((await response.json()) as { code: string }).code).toBe('editorialRequestInvalid')
    }
    expect(await noteOf(documentId)).toEqual({ state: 'draft', note: null })
  })

  it('lists only the types the caller may read', async () => {
    const { documentId } = await articles().create({ data: { title: 'Hidden', site } } as never)
    expect((await move('admin', documentId, 'in_review')).status).toBe(200)
    const service = strapi.plugin('micelio').service('transitions')
    const ids = (sites: Listed[]) =>
      sites.flatMap((group) => group.entries.map((entry) => entry.documentId))
    expect(ids(await service.inReview((uid: string) => uid === ARTICLE))).toContain(documentId)
    expect(ids(await service.inReview((uid: string) => uid !== ARTICLE))).not.toContain(documentId)
  })

  it('lists the In review page only for a role with its permission', async () => {
    const response = await request('author', '/micelio/review')
    expect(response.status).toBe(403)
    expect(((await response.json()) as { code: string }).code).toBe('reviewForbidden')
  })

  it('shows the note to no one through the content API, draft or published', async () => {
    const token = (
      (await strapi.service('admin::api-token').create({
        name: 'review-note-test',
        type: 'full-access',
        lifespan: null,
      })) as { accessKey: string }
    ).accessKey
    const { documentId } = await articles().create({ data: { title: 'Private', site } } as never)
    expect((await move('admin', documentId, 'in_review', 'Only for the editor')).status).toBe(200)
    expect((await move('admin', documentId, 'published', 'Approved, thanks')).status).toBe(200)
    expect(await noteOf(documentId)).toEqual({ state: 'published', note: 'Approved, thanks' })
    for (const status of ['draft', 'published']) {
      const response = await fetch(
        `${base}/api/articles/${documentId}?status=${status}&populate=editorial`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      expect(response.status, status).toBe(200)
      const { data } = (await response.json()) as { data: { editorial: object } }
      expect(data.editorial, status).toMatchObject({ state: 'published' })
      expect(data.editorial, status).not.toHaveProperty('note')
    }
  })

  // Runs last: it gives the Author role the permission the test above refuses it.
  it('lists to an author only the entries its own permission lets it read', async () => {
    await strapi
      .service('admin::role')
      .addPermissions(await roleId('strapi-author'), [{ action: REVIEW_READ_PERMISSION }])
    const author = (await strapi.db.query('admin::user').findOne({
      where: { email: 'note-author@example.com' },
    })) as { id: number }
    const own = (await articles().create({ data: { title: 'Mine', site } } as never)).documentId
    // The Author role reads only the entries it created (`admin::is-creator`).
    await strapi.db.query(ARTICLE).updateMany({
      where: { documentId: own },
      data: { createdBy: author.id },
    })
    const other = (await articles().create({ data: { title: 'Theirs', site } } as never)).documentId
    for (const documentId of [own, other]) {
      expect((await move('admin', documentId, 'in_review', 'Look')).status).toBe(200)
    }
    const listed = async (role: string) => {
      const response = await request(role, '/micelio/review')
      expect(response.status, role).toBe(200)
      const { data } = (await response.json()) as { data: Listed[] }
      return data.flatMap((group) => group.entries.map((entry) => entry.documentId))
    }
    const authorSees = await listed('author')
    expect(authorSees).toContain(own)
    expect(authorSees).not.toContain(other)
    expect(await listed('admin')).toEqual(expect.arrayContaining([own, other]))
  })
})
