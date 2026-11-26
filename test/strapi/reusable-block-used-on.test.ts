import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import { REUSABLE_BLOCK_UID } from '../../server/src/constants/reusable-blocks'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'

// The page fixture (test/strapi/app/src/api/page/) references reusable blocks through its
// `section.reusable` component; it is the one type of the test app that does.
const PAGE = 'api::page.page' as UID.ContentType
const REUSABLE = REUSABLE_BLOCK_UID as UID.ContentType
const READ = 'plugin::content-manager.explorer.read'
const PASSWORD = 'Password1234'

const cta = (title: string) => ({ __component: 'section.cta', title })
const reference = (documentId: string) => ({
  __component: 'section.reusable',
  reusableBlock: documentId,
})

// `GET /micelio/reusable-blocks/:documentId/used-on` (#262, D6): what the builder's publish dialog
// lists (#202).
describe('the pages that show a reusable block', () => {
  let strapi: Core.Strapi
  let base: string
  let site: string
  let other: string
  const tokens: Record<string, string> = {}

  async function createUser(email: string, subjects: string[] | 'super'): Promise<void> {
    const roles = strapi.service('admin::role')
    const role =
      subjects === 'super'
        ? await strapi.db.query('admin::role').findOne({ where: { code: 'strapi-super-admin' } })
        : await roles.create({ name: email, description: email })
    if (subjects !== 'super') {
      await roles.assignPermissions(
        role.id,
        subjects.map((subject) => ({ action: READ, subject, properties: {}, conditions: [] }))
      )
    }
    await strapi.service('admin::user').create({
      email,
      firstname: 'Editor',
      lastname: email.split('@')[0],
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
    })
    const response = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    tokens[email] = ((await response.json()) as { data: { token: string } }).data.token
  }

  const usedOn = (who: string, block: string, query = '') =>
    fetch(`${base}/micelio/reusable-blocks/${block}/used-on${query}`, {
      headers: { Authorization: `Bearer ${tokens[who]}` },
    })

  async function createBlock(name: string, inSite = site): Promise<string> {
    const created = await strapi.documents(REUSABLE).create({
      locale: 'en',
      data: { name, blocks: [cta(name)], site: inSite } as never,
    })
    return created.documentId
  }

  async function createPage(slug: string, sections: unknown[], inSite = site): Promise<string> {
    const created = await strapi.documents(PAGE).create({
      locale: 'en',
      data: { title: slug, slug, sections, site: inSite } as never,
    })
    return created.documentId
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    site = (await sites.findFirst({}))!.documentId
    other = (await sites.create({ data: { name: 'Other', slug: 'other', modules: {} } as never }))
      .documentId
    await createUser('root@example.com', 'super')
    await createUser('blocks-only@example.com', [REUSABLE])
    await createUser('pages-only@example.com', [PAGE])
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it("lists the pages of the block's site that show it, only of the types the caller may read, with the total", async () => {
    const block = await createBlock('Banner')
    const unused = await createBlock('Unused')
    const home = await createPage('home', [reference(block)])
    const about = await createPage('about', [cta('Own'), reference(block)])
    await createPage('contact', [reference(unused)])
    await createPage('elsewhere', [cta('Other site')], other)

    const answer = await usedOn('root@example.com', block, '?locale=en')
    expect(answer.status).toBe(200)
    expect(answer.headers.get('cache-control')).toBe('private, no-store')
    expect(await answer.json()).toEqual({
      data: [
        { uid: PAGE, documentId: about, locale: 'en', title: 'about', published: false },
        { uid: PAGE, documentId: home, locale: 'en', title: 'home', published: false },
      ],
      meta: { total: 2 },
    })
    // Another locale of the block has no page.
    expect(await (await usedOn('root@example.com', block, '?locale=es')).json()).toEqual({
      data: [],
      meta: { total: 0 },
    })
    // A caller who reads reusable blocks but not pages gets the count and no page.
    expect(await (await usedOn('blocks-only@example.com', block)).json()).toEqual({
      data: [],
      meta: { total: 2 },
    })
    const invalid = await usedOn('root@example.com', block, '?locale=')
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'reusableBlockRequestInvalid' })
  })

  it('refuses a caller who may not read reusable blocks', async () => {
    const block = await createBlock('Hidden')
    await createPage('shows-hidden', [reference(block)])
    const answer = await usedOn('pages-only@example.com', block)
    expect(answer.status).toBe(403)
    expect(answer.headers.get('content-type')).toContain('application/problem+json')
    expect(await answer.json()).toMatchObject({ status: 403, code: 'reusableBlockForbidden' })
    expect((await fetch(`${base}/micelio/reusable-blocks/${block}/used-on`)).status).toBe(401)
  })
})
