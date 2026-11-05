import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import {
  EXPECTED_VERSION_HEADER,
  VERSION_CONFLICT,
} from '../../server/src/constants/document-version'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'

const LANDING = 'api::landing.landing' as UID.ContentType
const PASSWORD = 'Password1234'

interface Saved {
  data?: { updatedAt: string; title: string }
  error?: { details?: { code?: string }; message: string }
}

// The save of the builder over a draft that someone else saved after it was read (#49): the Content
// Manager's API has no version check of its own, so the plugin adds one, inside the same turn as the
// write.
describe('a save that names the version it read', () => {
  let strapi: Core.Strapi
  let base: string
  let token: string
  let siteId: string

  async function newPage(): Promise<{ documentId: string; updatedAt: string }> {
    const created = await strapi.documents(LANDING).create({
      locale: 'en',
      data: { title: 'First', site: siteId, sections: [] } as never,
    })
    const read = await put(created.documentId, { title: 'First' })
    return {
      documentId: created.documentId,
      updatedAt: ((await read.json()) as Saved).data!.updatedAt,
    }
  }

  function put(documentId: string, data: object, version?: string): Promise<Response> {
    return fetch(`${base}/content-manager/collection-types/${LANDING}/${documentId}?locale=en`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(version === undefined ? {} : { [EXPECTED_VERSION_HEADER]: version }),
      },
      body: JSON.stringify(data),
    })
  }

  const titleOf = async (documentId: string): Promise<string> =>
    (
      (await strapi
        .documents(LANDING)
        .findOne({ documentId, locale: 'en', status: 'draft' })) as unknown as { title: string }
    ).title

  beforeAll(async () => {
    strapi = await setupStrapi()
    // A database that takes its time to write, so that two saves have both read before either wrote.
    strapi.documents.use(async (context, next) => {
      if (context.action === 'update') await new Promise((done) => setTimeout(done, 150))
      return next()
    })
    base = `http://127.0.0.1:${(strapi.server.httpServer.address() as AddressInfo).port}`
    const role = await strapi.db
      .query('admin::role')
      .findOne({ where: { code: 'strapi-super-admin' } })
    await strapi.service('admin::user').create({
      email: 'version@example.com',
      firstname: 'Editor',
      lastname: 'Version',
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
    })
    const login = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'version@example.com', password: PASSWORD }),
    })
    token = ((await login.json()) as { data: { token: string } }).data.token
    siteId = (
      (await strapi.documents(SITE_UID as UID.ContentType).findFirst()) as {
        documentId: string
      }
    ).documentId
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('saves when the version is the one the draft holds', async () => {
    const { documentId, updatedAt } = await newPage()
    const saved = await put(documentId, { title: 'Second' }, updatedAt)
    expect(saved.status).toBe(200)
    expect(await titleOf(documentId)).toBe('Second')
  })

  it('refuses a save over a draft that changed, and writes nothing', async () => {
    const { documentId, updatedAt } = await newPage()
    expect((await put(documentId, { title: 'Theirs' })).status).toBe(200)
    const refused = await put(documentId, { title: 'Mine' }, updatedAt)
    expect(refused.status).toBe(400)
    const body = (await refused.json()) as Saved
    expect(body.error?.details?.code).toBe(VERSION_CONFLICT)
    expect(await titleOf(documentId)).toBe('Theirs')
  })

  it('saves as before when the request names no version', async () => {
    const { documentId } = await newPage()
    expect((await put(documentId, { title: 'Theirs' })).status).toBe(200)
    expect((await put(documentId, { title: 'Mine' })).status).toBe(200)
    expect(await titleOf(documentId)).toBe('Mine')
  })

  it('refuses a version that is not a date', async () => {
    const { documentId } = await newPage()
    const refused = await put(documentId, { title: 'Mine' }, 'yesterday-ish')
    expect(refused.status).toBe(400)
    expect(await titleOf(documentId)).toBe('First')
  })

  it('lets one of two saves that cross through, and refuses the other', async () => {
    const { documentId, updatedAt } = await newPage()
    const answers = await Promise.all([
      put(documentId, { title: 'Left' }, updatedAt),
      put(documentId, { title: 'Right' }, updatedAt),
    ])
    expect(answers.map(({ status }) => status).sort()).toEqual([200, 400])
    const winner = answers[0]!.status === 200 ? 'Left' : 'Right'
    expect(await titleOf(documentId)).toBe(winner)
  })
})
