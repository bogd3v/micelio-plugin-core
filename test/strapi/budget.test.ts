import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import config, { type PluginConfig } from '../../server/src/config'
import { PREVIEW_PERMISSION, PREVIEW_CREDENTIAL_UID } from '../../server/src/constants/preview'
import { SITE_UID } from '../../server/src/constants/site'
import { TransitionError } from '../../server/src/editorial/transitions'
import type { BudgetService } from '../../server/src/services/budget'
import type { TransitionsService } from '../../server/src/services/transitions'
import { refusalNotice } from '../../admin/src/utils/refusal'
import { closedOrigin } from './frontend'
import { cleanupStrapi, setupStrapi } from './harness'
import { startWeightSite, type WeightSite } from './weight-site'

// `story` is site-scoped, editorial and has a dynamic zone: the kind of type that is measured at
// publish (test/strapi/app/src/api/story/). `article` is editorial without one: it is not measured.
const STORY = 'api::story.story' as UID.ContentType
const ARTICLE = 'api::article.article' as UID.ContentType
const PASSWORD = 'Password1234'
// The core's budget for a page without a page type of its own.
const STANDARD_KB = 120

interface Problem {
  status: number
  code: string
  detail: string
  pageType?: string
  budgetKb?: number
  blocksKb?: number
  frameworkKb?: number
  totalKb?: number
  overByKb?: number
  blocks?: { position: number; id: string; kb: number }[]
}

describe('the budgets configuration', () => {
  const invalid = (budgets: unknown) => () => config.validator({ budgets } as never)

  it.each([
    ['a page type of 0 kB', { pageTypes: { standard: 0 } }],
    ['a budget given as a string', { pageTypes: { standard: '120' } }],
    ['a negative budget', { pageTypes: { standard: -1 } }],
    ['a budget that is not finite', { pageTypes: { standard: Infinity } }],
    ['pageTypes as an array', { pageTypes: [120] }],
    ['a site that maps a page type to a non-number', { sites: { blog: { standard: 'big' } } }],
    ['sites as an array', { sites: [{ standard: 100 }] }],
    ['a site that is not a map', { sites: { blog: 100 } }],
    ['contentTypes as a string', { contentTypes: 'api::page.page' }],
    ['a content type that is not a UID', { contentTypes: ['page'] }],
    ['a content type that is not a string', { contentTypes: [5] }],
    ['budgets as null', null],
    ['budgets as an array', []],
    ['budgets as a number', 5],
  ])('refuses %s, naming the key', (_name, budgets) => {
    expect(invalid(budgets)).toThrow(/^micelio: budgets/)
  })

  it('accepts a valid map, a partial one and none', () => {
    expect(invalid({ pageTypes: { landing: 50, 'long-read': 200 } })).not.toThrow()
    expect(invalid({ sites: { blog: { standard: 90 } } })).not.toThrow()
    expect(invalid({ pageTypes: {}, sites: {} })).not.toThrow()
    expect(invalid({ contentTypes: ['api::page.page', 'plugin::shop.product'] })).not.toThrow()
    expect(invalid({ contentTypes: [] })).not.toThrow()
    expect(invalid(undefined)).not.toThrow()
  })
})

describe('the budget of a page at publish', () => {
  let strapi: Core.Strapi
  let base: string
  let site: string
  let siteSlug: string
  let frontend: WeightSite
  let apiToken: string
  let admin: string
  // A user who may do everything, for the transitions service.
  let actor: { kind: 'user'; id: number; roles: string[] }
  let counter = 0
  const sites = () => strapi.documents(SITE_UID as UID.ContentType)
  const stories = () => strapi.documents(STORY)
  const transitions = () => strapi.plugin('micelio').service('transitions') as TransitionsService

  async function signIn(email: string): Promise<string> {
    const response = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    return ((await response.json()) as { data: { token: string } }).data.token
  }

  async function newAdmin(roleCode = 'strapi-super-admin'): Promise<string> {
    counter += 1
    const role = (await strapi.db.query('admin::role').findOne({ where: { code: roleCode } })) as {
      id: number
    }
    const email = `admin-${counter}@example.com`
    await strapi.service('admin::user').create({
      email,
      firstname: 'Admin',
      lastname: String(counter),
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
    })
    return signIn(email)
  }

  /** A story in review with this many blocks, each weighing `frontend.blockKb`. */
  async function storyOf(blocks: number): Promise<string> {
    const created = await stories().create({
      locale: 'en',
      data: {
        title: 'A page',
        site,
        blocks: Array.from({ length: blocks }, () => ({
          __component: 'shared.quote',
          title: 'Said',
          body: 'Something',
        })),
      } as never,
    })
    await move(created.documentId, 'in_review')
    return created.documentId
  }

  async function move(documentId: string, to: string, token = admin): Promise<Response> {
    return fetch(`${base}/micelio/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ uid: STORY, documentId, locale: 'en', to }),
    })
  }

  const publish = (documentId: string) => move(documentId, 'published')

  async function problemOf(response: Response): Promise<Problem> {
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    return (await response.json()) as Problem
  }

  async function isPublished(documentId: string): Promise<boolean> {
    return (await stories().findOne({ documentId, locale: 'en', status: 'published' })) !== null
  }

  async function stateOf(documentId: string): Promise<string | undefined> {
    const draft = (await stories().findOne({
      documentId,
      locale: 'en',
      status: 'draft',
      populate: ['editorial'],
    } as never)) as unknown as { editorial?: { state?: string } } | null
    return draft?.editorial?.state
  }

  function measure(token: string, body: unknown): Promise<Response> {
    return fetch(`${base}/micelio/budget/measure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const row = (await sites().findFirst({}))!
    site = row.documentId
    siteSlug = row.slug as string
    apiToken = (
      (await strapi.service('admin::api-token').create({
        name: 'budget-suite',
        type: 'full-access',
        lifespan: null,
      })) as { accessKey: string }
    ).accessKey
    frontend = await startWeightSite({ base, apiToken, siteSlug })
    await sites().update({ documentId: site, data: { url: frontend.origin } } as never)
    admin = await newAdmin()
    const user = (await strapi.db.query('admin::user').findOne({
      where: { email: 'admin-1@example.com' },
    })) as { id: number }
    actor = { kind: 'user', id: user.id, roles: ['strapi-super-admin'] }
  })

  afterAll(async () => {
    await frontend.close()
    await cleanupStrapi()
  })

  beforeEach(() => {
    frontend.queue = []
    frontend.baseKb = 10
    frontend.blockKb = 5
    frontend.onDemandKb = undefined
    frontend.onRender = undefined
    frontend.beforeRead = undefined
    frontend.requests.length = 0
  })

  it('keeps the default of every page type a host does not set', () => {
    // The test app sets only `long-read` and a list of one type (test/strapi/app/config/plugins.js):
    // Strapi merges arrays index by index, so a default list would leave its second UID behind.
    expect(strapi.config.get<PluginConfig['budgets']>('plugin::micelio.budgets')).toEqual({
      pageTypes: { landing: 60, standard: 120, 'long-read': 200 },
      sites: {},
      contentTypes: ['api::story.story'],
    })
  })

  describe('under its budget', () => {
    it('publishes through the admin route after the frontend measured the draft', async () => {
      const documentId = await storyOf(3)
      const response = await publish(documentId)
      expect(response.status).toBe(200)
      expect(await isPublished(documentId)).toBe(true)
      expect(await stateOf(documentId)).toBe('published')
    })

    it('asks the weight route of the site once, in the dynamic mode and the locale of the grant', async () => {
      await publish(await storyOf(1))
      expect(frontend.requests).toHaveLength(1)
      const [seen] = frontend.requests
      expect(seen!.path).toBe(
        `/api/preview/${encodeURIComponent(STORY)}/${seen!.path.split('/')[4]}/weight`
      )
      expect(seen!.query).toEqual({ mode: 'dynamic', locale: 'en' })
      expect(seen!.grant).toMatch(/^[A-Za-z0-9_-]{43}$/)
    })

    it('mints a system grant for the draft, spends it, and stores only its hash', async () => {
      const documentId = await storyOf(1)
      await publish(documentId)
      const rows = (await strapi.db
        .query(PREVIEW_CREDENTIAL_UID)
        .findMany({ where: { entryDocumentId: documentId } })) as {
        kind: string
        hash: string
        usedAt: string | null
        adminUser: number | null
        entryLocale: string | null
      }[]
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ kind: 'system', adminUser: null, entryLocale: 'en' })
      expect(rows[0]!.usedAt).not.toBeNull()
      expect(rows[0]!.hash).not.toBe(frontend.requests[0]!.grant)
    })

    it('publishes through the transitions service, as the scheduler and other plugins do', async () => {
      const documentId = await storyOf(2)
      const result = await transitions().perform({
        uid: STORY,
        documentId,
        locale: 'en',
        to: 'published',
        actor,
      })
      expect(result).toMatchObject({ from: 'in_review', to: 'published' })
      expect(await isPublished(documentId)).toBe(true)
    })

    it('counts the weight of the blocks and never the framework or the script islands load on demand', async () => {
      // 500 kB of framework and 600 kB on demand around 20 kB of blocks
      frontend.baseKb = 500
      frontend.blockKb = 10
      frontend.onDemandKb = { quote: 300 }
      const documentId = await storyOf(2)
      expect((await publish(documentId)).status).toBe(200)
    })

    it('does not measure a listed type without blocks: an editorial article publishes with no frontend at all', async () => {
      // Listed, so only the schema half of `applies` keeps it out: it has no dynamic zone.
      const configured = strapi.config.get<PluginConfig['budgets']>('plugin::micelio.budgets')
      strapi.config.set('plugin::micelio.budgets', {
        ...configured,
        contentTypes: [STORY, ARTICLE],
      })
      const before = frontend.requests.length
      try {
        expect((strapi.plugin('micelio').service('budget') as BudgetService).applies(ARTICLE)).toBe(
          false
        )
        const created = await strapi
          .documents(ARTICLE)
          .create({ data: { title: 'Plain', site } as never })
        for (const to of ['in_review', 'published'] as const) {
          await transitions().perform({ uid: ARTICLE, documentId: created.documentId, to, actor })
        }
      } finally {
        strapi.config.set('plugin::micelio.budgets', configured)
      }
      expect(frontend.requests).toHaveLength(before)
    })
  })

  describe('a type the budgets do not list', () => {
    it('publishes with no measurement, even with a dynamic zone: no grant, no request to the frontend', async () => {
      const documentId = await storyOf(5)
      frontend.blockKb = 100
      const configured = strapi.config.get<PluginConfig['budgets']>('plugin::micelio.budgets')
      strapi.config.set('plugin::micelio.budgets', {
        ...configured,
        contentTypes: [ARTICLE],
      })
      const before = frontend.requests.length
      try {
        expect((await publish(documentId)).status).toBe(200)
      } finally {
        strapi.config.set('plugin::micelio.budgets', configured)
      }
      expect(await isPublished(documentId)).toBe(true)
      expect(frontend.requests).toHaveLength(before)
      const grants = await strapi.db
        .query(PREVIEW_CREDENTIAL_UID)
        .findMany({ where: { entryDocumentId: documentId } })
      expect(grants).toHaveLength(0)
    })

    it('publishes as before when the list is empty', async () => {
      const documentId = await storyOf(5)
      frontend.blockKb = 100
      const configured = strapi.config.get<PluginConfig['budgets']>('plugin::micelio.budgets')
      strapi.config.set('plugin::micelio.budgets', { ...configured, contentTypes: [] })
      const before = frontend.requests.length
      try {
        expect((await publish(documentId)).status).toBe(200)
      } finally {
        strapi.config.set('plugin::micelio.budgets', configured)
      }
      expect(frontend.requests).toHaveLength(before)
    })
  })

  describe('over its budget', () => {
    beforeEach(() => {
      frontend.baseKb = 20
      frontend.blockKb = { quote: 30 }
    })

    it('refuses through the admin route with the blocks and by how much, and writes nothing', async () => {
      const documentId = await storyOf(5)
      const response = await publish(documentId)
      expect(response.status).toBe(409)
      const problem = await problemOf(response)
      expect(problem).toMatchObject({
        code: 'pageOverBudget',
        status: 409,
        pageType: 'standard',
        budgetKb: STANDARD_KB,
        blocksKb: 150,
        frameworkKb: 20,
        totalKb: 170,
        overByKb: 30,
      })
      expect(problem.blocks).toHaveLength(5)
      expect(problem.blocks![0]).toEqual({ position: 1, id: 'quote', kb: 30 })
      expect(problem.detail).toContain('30 kB over')
      expect(await isPublished(documentId)).toBe(false)
      expect(await stateOf(documentId)).toBe('in_review')
    })

    it('refuses through the transitions service, which every path to publishing runs', async () => {
      const documentId = await storyOf(5)
      await expect(
        transitions().perform({
          uid: STORY,
          documentId,
          locale: 'en',
          to: 'published',
          actor,
        })
      ).rejects.toMatchObject({ code: 'pageOverBudget', status: 409 })
      expect(await isPublished(documentId)).toBe(false)
    })

    it('refuses a publish through the Document Service and through Strapi’s own button, which the transitions alone may do', async () => {
      const documentId = await storyOf(1)
      await expect(stories().publish({ documentId, locale: 'en' } as never)).rejects.toThrow(
        /editorial transitions/
      )
      const native = await fetch(
        `${base}/content-manager/collection-types/${STORY}/${documentId}/actions/publish?locale=en`,
        { method: 'POST', headers: { Authorization: `Bearer ${admin}` } }
      )
      expect(native.status).toBe(403)
      expect(await isPublished(documentId)).toBe(false)
    })

    it('refuses to republish a page that grew over its budget since it was published', async () => {
      const documentId = await storyOf(1)
      expect((await publish(documentId)).status).toBe(200)
      frontend.blockKb = { quote: 130 }
      const response = await publish(documentId)
      expect(response.status).toBe(409)
      expect((await problemOf(response)).code).toBe('pageOverBudget')
    })

    it('answers a problem detail the admin’s notification reads, over its budget and unmeasurable', async () => {
      const entry = { uid: STORY, documentId: await storyOf(2), locale: 'en' }
      frontend.blockKb = 70
      const over = refusalNotice(await problemOf(await publish(entry.documentId)), entry)
      expect(over?.message).toEqual({
        id: 'refusal.pageOverBudget',
        values: {
          weight: '140',
          budget: '120',
          over: '20',
          blocks: 'quote (70 kB), quote (70 kB)',
        },
      })
      expect(over?.previewPath).toContain(
        `/preview/${encodeURIComponent(STORY)}/${entry.documentId}`
      )
      frontend.blockKb = 5
      frontend.queue = [{ status: 500 }]
      const unavailable = refusalNotice(await problemOf(await publish(entry.documentId)), entry)
      expect(unavailable?.message.id).toBe('refusal.previewUnavailable')
      expect(unavailable?.message.values.cause).toMatch(/^The frontend could not measure the page/)
    })

    it('leaves a scheduled page scheduled when the scheduler finds it over its budget or unmeasurable', async () => {
      const { documentId } = await stories().create({
        locale: 'en',
        data: {
          title: 'A scheduled page',
          site,
          blocks: Array.from({ length: 5 }, () => ({
            __component: 'shared.quote',
            title: 'Said',
            body: 'Something',
          })),
        } as never,
      })
      const inAnHour = new Date(Date.now() + 3_600_000)
      await transitions().perform({
        uid: STORY,
        documentId,
        locale: 'en',
        to: 'scheduled',
        publishAt: inAnHour,
        actor,
      })
      const due = new Date(inAnHour.getTime() + 1000)
      expect(await transitions().publishDue(due)).toBe(0)
      expect(await stateOf(documentId)).toBe('scheduled')
      expect(await isPublished(documentId)).toBe(false)

      await sites().update({ documentId: site, data: { url: await closedOrigin() } } as never)
      try {
        frontend.blockKb = 1
        expect(await transitions().publishDue(due)).toBe(0)
        expect(await stateOf(documentId)).toBe('scheduled')
        expect(await isPublished(documentId)).toBe(false)
      } finally {
        await sites().update({ documentId: site, data: { url: frontend.origin } } as never)
      }

      frontend.blockKb = 1
      expect(await transitions().publishDue(due)).toBe(1)
      expect(await isPublished(documentId)).toBe(true)
    })

    it('allows what is exactly on the budget', async () => {
      frontend.baseKb = 20
      frontend.blockKb = 24
      expect((await publish(await storyOf(5))).status).toBe(200)
    })

    it('does not ask the frontend for a transition that is not a publish', async () => {
      const documentId = await storyOf(5)
      frontend.requests.length = 0
      expect((await move(documentId, 'draft')).status).toBe(200)
      expect(frontend.requests).toHaveLength(0)
    })

    it('takes the budget of the site from its configuration', async () => {
      const documentId = await storyOf(5)
      const configured = strapi.config.get<PluginConfig['budgets']>('plugin::micelio.budgets')
      strapi.config.set('plugin::micelio.budgets', {
        ...configured,
        pageTypes: { standard: 120 },
        sites: { [siteSlug]: { standard: 200 } },
      })
      try {
        expect((await publish(documentId)).status).toBe(200)
      } finally {
        strapi.config.set('plugin::micelio.budgets', configured)
      }
    })
  })

  describe('when the measurement fails, it refuses with previewUnavailable', () => {
    // The sentence an editor reads when the frontend fails: its cause stays in the log.
    const FIXED = /^The frontend could not measure the page/
    async function expectRefused(
      documentId: string,
      detail: RegExp,
      logged?: RegExp
    ): Promise<void> {
      const logs = vi.spyOn(strapi.log, 'warn')
      try {
        const response = await publish(documentId)
        expect(response.status).toBe(409)
        const problem = await problemOf(response)
        expect(problem.code).toBe('previewUnavailable')
        expect(problem.detail).toMatch(detail)
        if (logged) {
          expect(logs.mock.calls.map(([message]) => String(message)).join('\n')).toMatch(logged)
        }
      } finally {
        logs.mockRestore()
      }
      expect(await isPublished(documentId)).toBe(false)
      expect(await stateOf(documentId)).toBe('in_review')
    }

    it('when the frontend is unreachable, without telling the editor where it was looked for', async () => {
      const documentId = await storyOf(1)
      const url = await closedOrigin()
      await sites().update({ documentId: site, data: { url } } as never)
      try {
        await expectRefused(documentId, FIXED, /did not answer/)
        const problem = await problemOf(await publish(documentId))
        expect(problem.detail).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/)
      } finally {
        await sites().update({ documentId: site, data: { url: frontend.origin } } as never)
      }
    })

    it('when the site has no url', async () => {
      const documentId = await storyOf(1)
      await sites().update({ documentId: site, data: { url: null } } as never)
      try {
        await expectRefused(documentId, /no url/)
      } finally {
        await sites().update({ documentId: site, data: { url: frontend.origin } } as never)
      }
    })

    it('when the frontend redirects, and follows nothing', async () => {
      const elsewhere = await startWeightSite({ base, apiToken, siteSlug })
      try {
        frontend.redirectTo = `${elsewhere.origin}/api/preview/x/y/weight`
        frontend.queue = ['redirect']
        await expectRefused(await storyOf(1), FIXED, /did not answer/)
        expect(frontend.requests).toHaveLength(1)
        expect(elsewhere.requests).toHaveLength(0)
      } finally {
        frontend.redirectTo = undefined
        await elsewhere.close()
      }
    })

    it.each([
      ['answers 500', { status: 500 }, /answered 500/],
      ['answers 404, as for a grant it refuses', { status: 404 }, /answered 404/],
      ['answers something that is not JSON', 'not-json', /not JSON/],
      ['answers a report it cannot read', 'wrong-shape', /cannot read/],
    ] as const)('when the frontend %s', async (_name, answer, logged) => {
      frontend.queue = [answer]
      await expectRefused(await storyOf(1), FIXED, logged)
    })

    it('when it rate limits past the retries, after four requests with four grants', async () => {
      const retry = { status: 429, retryAfter: '0' }
      frontend.queue = [retry, retry, retry, retry]
      await expectRefused(await storyOf(1), FIXED, /rate limiting/)
      expect(frontend.requests).toHaveLength(4)
      expect(new Set(frontend.requests.map((seen) => seen.grant)).size).toBe(4)
    })

    it('but publishes when a retry gets through, with a new grant', async () => {
      frontend.queue = [{ status: 429, retryAfter: '0' }]
      const documentId = await storyOf(1)
      expect((await publish(documentId)).status).toBe(200)
      expect(frontend.requests).toHaveLength(2)
      expect(frontend.requests[0]!.grant).not.toBe(frontend.requests[1]!.grant)
    })

    it('when the draft was saved after it was measured', async () => {
      const documentId = await storyOf(1)
      frontend.onRender = async () => {
        frontend.onRender = undefined
        await stories().update({
          documentId,
          locale: 'en',
          data: { title: 'Saved meanwhile' } as never,
        })
      }
      await expectRefused(documentId, /saved while it was measured/)
    })

    it('when the draft was saved before the frontend read it, which refuses a grant of an older version', async () => {
      const documentId = await storyOf(1)
      frontend.beforeRead = async () => {
        frontend.beforeRead = undefined
        await stories().update({ documentId, locale: 'en', data: { title: 'Again' } as never })
      }
      await expectRefused(documentId, FIXED, /answered 404/)
    })
  })

  describe('POST /micelio/budget/measure', () => {
    // The body of the weight route as the admin got it with the editor's grant.
    function reportOf(blocks: number, blockKb: number, baseKb = 20) {
      return {
        data: {
          mode: 'dynamic',
          htmlKb: 1,
          cssKb: 1,
          jsKb: 1,
          fontKb: 1,
          imagesKb: 0,
          totalKb: baseKb + blocks * blockKb,
          onDemandKb: 0,
          blocks: Array.from({ length: blocks }, () => ({
            id: 'quote',
            kb: blockKb,
            onDemandKb: 0,
          })),
        },
      }
    }

    it('places the report the admin got against the budget of the saved draft, over it or not', async () => {
      const documentId = await storyOf(5)
      const response = await measure(await newAdmin(), {
        uid: STORY,
        documentId,
        locale: 'en',
        report: reportOf(5, 30),
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      const { data } = (await response.json()) as { data: Record<string, unknown> }
      expect(data).toMatchObject({
        pageType: 'standard',
        budgetKb: STANDARD_KB,
        blocksKb: 150,
        frameworkKb: 20,
        totalKb: 170,
        overByKb: 30,
        onDemandKb: 0,
      })
      expect(data.measuredAt).toMatch(/^\d{4}-\d\d-\d\dT/)
      expect(new Date(data.version as string).getTime()).not.toBeNaN()
      expect(data.blocks).toHaveLength(5)
    })

    it('mints no system grant and asks no frontend: only the publish path does', async () => {
      const documentId = await storyOf(1)
      const previews = strapi.plugin('micelio').service('preview') as {
        issueSystemGrant: (...args: unknown[]) => Promise<string>
      }
      const issue = vi.spyOn(previews, 'issueSystemGrant')
      const credentials = () => strapi.db.query(PREVIEW_CREDENTIAL_UID).count({})
      const before = await credentials()
      try {
        const response = await measure(await newAdmin(), {
          uid: STORY,
          documentId,
          locale: 'en',
          report: reportOf(1, 5),
        })
        expect(response.status).toBe(200)
        expect(issue).not.toHaveBeenCalled()
      } finally {
        issue.mockRestore()
      }
      expect(await credentials()).toBe(before)
      expect(frontend.requests).toHaveLength(0)
    })

    it('refuses a report that is not the weight route’s answer', async () => {
      const documentId = await storyOf(1)
      const token = await newAdmin()
      for (const report of [undefined, { data: { totalKb: 'heavy' } }, 'x']) {
        const response = await measure(token, { uid: STORY, documentId, locale: 'en', report })
        expect(response.status).toBe(400)
        expect((await problemOf(response)).code).toBe('budgetRequestInvalid')
      }
    })

    it('refuses an admin user without the permission to preview', async () => {
      const documentId = await storyOf(1)
      const response = await measure(await newAdmin('strapi-editor'), {
        uid: STORY,
        documentId,
        report: reportOf(1, 5),
      })
      expect(response.status).toBe(403)
      expect((await problemOf(response)).code).toBe('previewForbidden')
    })

    it('refuses a user who may preview and may not read the draft', async () => {
      counter += 1
      const role = (await strapi
        .service('admin::role')
        .create({ name: `Previewer ${counter}`, code: `previewer-${counter}` })) as { id: number }
      await strapi
        .service('admin::role')
        .addPermissions(role.id, [
          { action: PREVIEW_PERMISSION, subject: null, conditions: [], properties: {} },
        ])
      await strapi.service('admin::user').create({
        email: `previewer-${counter}@example.com`,
        firstname: 'Previewer',
        lastname: 'Test',
        password: PASSWORD,
        roles: [role.id],
        isActive: true,
      })
      const token = await signIn(`previewer-${counter}@example.com`)
      const documentId = await storyOf(1)
      const response = await measure(token, { uid: STORY, documentId, report: reportOf(1, 5) })
      expect(response.status).toBe(403)
    })

    it.each([
      ['a type without blocks', { uid: ARTICLE, documentId: 'x' }, 400, 'budgetTypeInvalid'],
      ['a body that is not valid', { uid: STORY }, 400, 'budgetRequestInvalid'],
      [
        'a draft that does not exist',
        { uid: STORY, documentId: 'nope' },
        404,
        'editorialEntryNotFound',
      ],
    ])('answers %s', async (_name, body, status, code) => {
      const response = await measure(await newAdmin(), { ...body, report: reportOf(1, 5) })
      expect(response.status).toBe(status)
      expect((await problemOf(response)).code).toBe(code)
    })

    it('refuses a request without an admin session', async () => {
      const response = await fetch(`${base}/micelio/budget/measure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: STORY, documentId: 'x' }),
      })
      expect(response.status).toBe(401)
    })
  })

  it('has the TransitionError the controllers branch on', () => {
    expect(new TransitionError(409, 'pageOverBudget', 'x', { overByKb: 1 }).extensions).toEqual({
      overByKb: 1,
    })
  })
})
