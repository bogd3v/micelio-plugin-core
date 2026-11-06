import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'

const ARTICLE = 'api::article.article' as UID.ContentType
const PASSWORD = 'Password1234'

interface Editorial {
  state: string
  publishAt: string | null
  note: string | null
}

// Editing a scheduled entry moves it back to draft (issue #57, a breaking change): what was
// scheduled is not what would publish. Through the Content Manager, the content API and the
// document service alike.
describe('an edit of a scheduled entry', () => {
  let strapi: Core.Strapi
  let base: string
  let token: string
  let apiToken: string
  let site: string

  const articles = () => strapi.documents(ARTICLE)

  async function scheduled(): Promise<string> {
    const { documentId } = await articles().create({ data: { title: 'Soon', site } } as never)
    const response = await fetch(`${base}/micelio/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        uid: ARTICLE,
        documentId,
        to: 'scheduled',
        publishAt: new Date(Date.now() + 3_600_000).toISOString(),
        note: 'Publish with the launch',
      }),
    })
    expect(response.status).toBe(200)
    expect((await editorialOf(documentId)).state).toBe('scheduled')
    return documentId
  }

  async function editorialOf(documentId: string): Promise<Editorial> {
    const draft = (await articles().findOne({
      documentId,
      status: 'draft',
      populate: ['editorial'],
    } as never)) as unknown as { editorial: Editorial }
    return draft.editorial
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    site = (await strapi.documents(SITE_UID as UID.ContentType).findFirst({}))!.documentId
    const role = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    await strapi.service('admin::user').create({
      email: 'schedule@example.com',
      firstname: 'Schedule',
      lastname: 'Test',
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
    })
    const login = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'schedule@example.com', password: PASSWORD }),
    })
    token = ((await login.json()) as { data: { token: string } }).data.token
    apiToken = (
      (await strapi.service('admin::api-token').create({
        name: 'schedule',
        type: 'full-access',
        lifespan: null,
      })) as { accessKey: string }
    ).accessKey
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('editing a scheduled page moves it back to draft', async () => {
    // The Content Manager sends the component back as it read it, `scheduled` included.
    const documentId = await scheduled()
    const before = await editorialOf(documentId)
    const saved = await fetch(`${base}/content-manager/collection-types/${ARTICLE}/${documentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: 'Soon, edited', editorial: { ...before } }),
    })
    expect(saved.status).toBe(200)
    expect(await editorialOf(documentId)).toMatchObject({
      state: 'draft',
      publishAt: null,
      note: 'Publish with the launch',
    })
    // The answer of the save says so, which is how the builder learns it.
    const answer = (await saved.json()) as { data: { editorial?: { state?: string } } }
    expect(answer.data.editorial?.state).toBe('draft')

    // The content API, which never sends the component.
    const viaApi = await scheduled()
    const put = await fetch(`${base}/api/articles/${viaApi}?status=draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ data: { title: 'Soon, from the API' } }),
    })
    expect(put.status).toBe(200)
    expect((await editorialOf(viaApi)).state).toBe('draft')

    // The scheduler has nothing to publish any more.
    const due = new Date(Date.now() + 2 * 3_600_000)
    expect(await strapi.plugin('micelio').service('transitions').publishDue(due)).toBe(0)
  })

  it('an edit of an entry in any other state keeps its state', async () => {
    const { documentId } = await articles().create({ data: { title: 'Review me', site } } as never)
    const sent = await fetch(`${base}/micelio/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ uid: ARTICLE, documentId, to: 'in_review' }),
    })
    expect(sent.status).toBe(200)
    await articles().update({ documentId, data: { title: 'Review me, edited' } } as never)
    expect((await editorialOf(documentId)).state).toBe('in_review')
  })
})
