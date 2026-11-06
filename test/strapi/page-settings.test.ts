import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import type { PluginConfig } from '../../server/src/config'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'
import { startWeightSite, type WeightSite } from './weight-site'

// `guide` is site-scoped, editorial, has a zone of sections and is made with `withPageSettings`
// (test/strapi/app/src/api/guide/). The budgets list it here, so its publish is measured.
const GUIDE = 'api::guide.guide' as UID.ContentType
const PASSWORD = 'Password1234'

interface Problem {
  code: string
  pageType?: string
  budgetKb?: number
  blocksKb?: number
  overByKb?: number
}

describe('the page settings of a page', () => {
  let strapi: Core.Strapi
  let base: string
  let site: string
  let siteSlug: string
  let frontend: WeightSite
  let admin: string
  const guides = () => strapi.documents(GUIDE)
  const configured = () => strapi.config.get<PluginConfig['budgets']>('plugin::micelio.budgets')

  /** A guide in review of this page type with this many blocks, each weighing `frontend.blockKb`. */
  async function guideOf(blocks: number, pageType?: string): Promise<string> {
    const created = await guides().create({
      locale: 'en',
      data: {
        title: 'A guide',
        slug: `guide-${Math.random().toString(36).slice(2, 8)}`,
        site,
        ...(pageType === undefined ? {} : { pageType }),
        sections: Array.from({ length: blocks }, () => ({
          __component: 'section.rich-text',
          body: 'Open source, in plain words.',
        })),
      } as never,
    })
    await move(created.documentId, 'in_review')
    return created.documentId
  }

  const asAdmin = (path: string, init: { method?: string; json?: unknown } = {}) =>
    fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    })

  const move = (documentId: string, to: string) =>
    asAdmin('/micelio/transitions', {
      method: 'POST',
      json: { uid: GUIDE, documentId, locale: 'en', to },
    })

  /** The editor's save in the Content Manager, as the builder's drawer makes it. */
  const save = (documentId: string, data: object) =>
    asAdmin(`/content-manager/collection-types/${GUIDE}/${documentId}?locale=en`, {
      method: 'PUT',
      json: data,
    })

  async function isPublished(documentId: string): Promise<boolean> {
    return (await guides().findOne({ documentId, locale: 'en', status: 'published' })) !== null
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const row = (await strapi.documents(SITE_UID as UID.ContentType).findFirst({}))!
    site = row.documentId
    siteSlug = row.slug as string
    const apiToken = (
      (await strapi.service('admin::api-token').create({
        name: 'page-settings-suite',
        type: 'full-access',
        lifespan: null,
      })) as { accessKey: string }
    ).accessKey
    frontend = await startWeightSite({ base, apiToken, siteSlug })
    await strapi
      .documents(SITE_UID as UID.ContentType)
      .update({ documentId: site, data: { url: frontend.origin } as never })
    // `story` is the one type the test app lists; the guides are measured too, and `manifesto` is a page
    // type of this site's own.
    strapi.config.set('plugin::micelio.budgets', {
      ...configured(),
      pageTypes: { ...configured().pageTypes, manifesto: 30 },
      contentTypes: [GUIDE],
    })
    const role = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    await strapi.service('admin::user').create({
      email: 'page-settings@example.com',
      firstname: 'Page',
      lastname: 'Settings',
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
    })
    const login = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'page-settings@example.com', password: PASSWORD }),
    })
    admin = ((await login.json()) as { data: { token: string } }).data.token
  })

  afterAll(async () => {
    await frontend.close()
    await cleanupStrapi()
  })

  beforeEach(() => {
    frontend.queue = []
    frontend.baseKb = 10
    frontend.blockKb = 15
    frontend.requests.length = 0
  })

  it('a page over the landing budget saves, and publishing it is refused with pageOverBudget', async () => {
    // Five blocks of 15 kB: 75 kB, under the 120 kB of a standard page and over the 60 kB of a landing.
    const documentId = await guideOf(5, 'standard')

    const saved = await save(documentId, { pageType: 'landing' })
    expect(saved.status).toBe(200)

    const refused = await move(documentId, 'published')
    expect(refused.status).toBe(409)
    expect(refused.headers.get('content-type')).toContain('application/problem+json')
    expect(await refused.json()).toMatchObject({
      code: 'pageOverBudget',
      pageType: 'landing',
      budgetKb: 60,
      blocksKb: 75,
      overByKb: 15,
    })
    expect(await isPublished(documentId)).toBe(false)

    // Back to standard, the same page fits.
    expect((await save(documentId, { pageType: 'standard' })).status).toBe(200)
    expect((await move(documentId, 'published')).status).toBe(200)
    expect(await isPublished(documentId)).toBe(true)
  })

  it('measures a page of a custom page type against the budget the site set for it', async () => {
    const documentId = await guideOf(3, 'manifesto')
    const refused = await move(documentId, 'published')
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({
      code: 'pageOverBudget',
      pageType: 'manifesto',
      budgetKb: 30,
      blocksKb: 45,
    })
  })

  it('keeps the standard budget for a page type nobody configured, and for a page with none', async () => {
    frontend.blockKb = 30
    // 150 kB of blocks: over the 120 kB of `standard`, which both pages are measured against.
    const unlisted = await guideOf(5, 'unlisted')
    const refused = (await (await move(unlisted, 'published')).json()) as Problem
    expect(refused).toMatchObject({ code: 'pageOverBudget', pageType: 'standard', budgetKb: 120 })
    const none = await guideOf(5)
    expect(await (await move(none, 'published')).json()).toMatchObject({
      code: 'pageOverBudget',
      pageType: 'standard',
      budgetKb: 120,
    })
    const stored = (await guides().findOne({ documentId: none, locale: 'en' })) as unknown as {
      pageType: string
    }
    expect(stored.pageType).toBe('standard')
  })

  it('stores the visibility of a page as a component with its defaults', async () => {
    const documentId = await guideOf(1)
    const read = async () =>
      ((await guides().findOne({
        documentId,
        locale: 'en',
        populate: ['visibility'],
      } as never)) ?? {}) as { visibility?: Record<string, unknown> | null }
    expect((await read()).visibility ?? null).toBeNull()

    const saved = await save(documentId, { visibility: { noindex: true, inMenu: false } })
    expect(saved.status).toBe(200)
    expect((await read()).visibility).toMatchObject({
      inMenu: false,
      inSitemap: true,
      noindex: true,
    })
  })

  it('lists the page types a site has with their budgets, custom ones included', async () => {
    const response = await asAdmin(`/micelio/budget/page-types?site=${siteSlug}`)
    expect(response.status).toBe(200)
    // The host's config orders them; the drawer offers them as they come.
    const { data } = (await response.json()) as { data: { id: string; budgetKb: number }[] }
    expect(data).toHaveLength(4)
    expect(data).toEqual(
      expect.arrayContaining([
        { id: 'landing', budgetKb: 60 },
        { id: 'standard', budgetKb: 120 },
        { id: 'long-read', budgetKb: 200 },
        { id: 'manifesto', budgetKb: 30 },
      ])
    )
    const own = configured()
    strapi.config.set('plugin::micelio.budgets', { ...own, sites: { [siteSlug]: { landing: 45 } } })
    try {
      const ofSite = (await (
        await asAdmin(`/micelio/budget/page-types?site=${siteSlug}`)
      ).json()) as {
        data: { id: string; budgetKb: number }[]
      }
      expect(ofSite.data.find(({ id }) => id === 'landing')).toEqual({
        id: 'landing',
        budgetKb: 45,
      })
    } finally {
      strapi.config.set('plugin::micelio.budgets', own)
    }
    expect((await fetch(`${base}/micelio/budget/page-types?site=${siteSlug}`)).status).toBe(401)
  })
})
