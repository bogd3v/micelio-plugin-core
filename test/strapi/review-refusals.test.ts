import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'
import { startWeightSite, type WeightSite } from './weight-site'

const BROCHURE = 'api::brochure.brochure' as UID.ContentType
const PASSWORD = 'Password1234'

interface Problem {
  status?: number
  code: string
  detail: string
  blocks?: Record<string, unknown>[]
}

interface Answer {
  data: { from: string; to: string; warnings: Problem[] }
}

// The refusals the builder shows as notifications (issue #57), each produced by its scenario on
// `brochure`, a site-scoped, editorial page type with page settings whose sections hold a Scene (an
// island) and a call to action (a block with links). The frontend that measures it is a stub.
describe('the refusals of the review flow', () => {
  let strapi: Core.Strapi
  let base: string
  let token: string
  let site: string
  let frontend: WeightSite

  const brochures = () => strapi.documents(BROCHURE)

  async function page(
    title: string,
    sections: object[],
    extra: Record<string, unknown> = {}
  ): Promise<string> {
    const created = await brochures().create({
      locale: 'en',
      data: {
        title,
        slug: title.toLowerCase().replace(/\W+/g, '-'),
        site,
        sections,
        ...extra,
      } as never,
    })
    return created.documentId
  }

  function move(documentId: string, to: string, extra: Record<string, unknown> = {}) {
    return fetch(`${base}/micelio/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ uid: BROCHURE, documentId, locale: 'en', to, ...extra }),
    })
  }

  async function refusal(response: Response): Promise<Problem> {
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    return (await response.json()) as Problem
  }

  const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString()
  const text = (body: string) => ({ __component: 'section.rich-text', body })
  const cta = (url: string) => ({
    __component: 'section.cta',
    title: 'Ready?',
    primaryLink: { label: 'See the plans', url },
  })
  const scene = () => ({ __component: 'section.scene', variant: 'inline', alt: 'Hyphae' })

  /** Each scenario of the issue, and what it answers: a refusal, or the warning of a transition that went through. */
  const scenarios: Record<string, () => Promise<Response>> = {
    async pageOverBudget() {
      frontend.blockKb = { 'rich-text': 200 }
      const documentId = await page('Heavy', [text('A long read.')])
      expect((await move(documentId, 'in_review')).status).toBe(200)
      return move(documentId, 'published')
    },
    async editorialTransitionForbidden() {
      const documentId = await page('Not mine', [text('Words.')])
      expect((await move(documentId, 'in_review')).status).toBe(200)
      // The site lets only Editors publish what is in review: the Super Admin is not one.
      await strapi.documents(SITE_UID as UID.ContentType).update({
        documentId: site,
        data: { editorialPolicy: { 'in_review->published': ['strapi-editor'] } } as never,
      })
      return move(documentId, 'published')
    },
    async islandAlternativeMissing() {
      const documentId = await page('No poster', [text('Words.'), scene()])
      return move(documentId, 'in_review')
    },
    async sampleTextPresent() {
      const documentId = await page('From a template', [text('Write your story here.')], {
        templateSamples: ['Write your story here.'],
      })
      return move(documentId, 'scheduled', { publishAt: inAnHour() })
    },
    async linkToDraft() {
      await page('Pricing', [text('Plans.')])
      const documentId = await page('Home', [text('Welcome.'), cta('/pricing')])
      return move(documentId, 'in_review')
    },
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    strapi.config.set('plugin::micelio.budgets', {
      ...strapi.config.get<Record<string, unknown>>('plugin::micelio.budgets'),
      contentTypes: [BROCHURE],
    })
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const row = (await strapi.documents(SITE_UID as UID.ContentType).findFirst({}))!
    site = row.documentId
    const apiToken = (
      (await strapi.service('admin::api-token').create({
        name: 'review-refusals',
        type: 'full-access',
        lifespan: null,
      })) as { accessKey: string }
    ).accessKey
    frontend = await startWeightSite({ base, apiToken, siteSlug: row.slug as string })
    await strapi
      .documents(SITE_UID as UID.ContentType)
      .update({ documentId: site, data: { url: frontend.origin } as never })
    const role = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    await strapi.service('admin::user').create({
      email: 'review-refusals@example.com',
      firstname: 'Review',
      lastname: 'Refusals',
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
    })
    const login = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'review-refusals@example.com', password: PASSWORD }),
    })
    token = ((await login.json()) as { data: { token: string } }).data.token
  })

  afterAll(async () => {
    await frontend?.close()
    await cleanupStrapi()
  })

  beforeEach(async () => {
    frontend.baseKb = 10
    frontend.blockKb = 5
    await strapi.documents(SITE_UID as UID.ContentType).update({
      documentId: site,
      data: { editorialPolicy: null } as never,
    })
  })

  it('each refusal code is produced by its scenario', async () => {
    for (const [code, scenario] of Object.entries(scenarios)) {
      const response = await scenario()
      if (code === 'linkToDraft') {
        // A warning: the page went to review, and the answer says what the editor should know.
        expect(response.status, code).toBe(200)
        const { data } = (await response.json()) as Answer
        expect(data.to).toBe('in_review')
        expect(data.warnings.map((warning) => warning.code)).toEqual(['linkToDraft'])
      } else {
        expect([403, 409], code).toContain(response.status)
        expect((await refusal(response)).code).toBe(code)
      }
      await strapi.documents(SITE_UID as UID.ContentType).update({
        documentId: site,
        data: { editorialPolicy: null } as never,
      })
      frontend.blockKb = 5
    }
  })

  it('a refusal that names a block carries its id', async () => {
    const over = await refusal(await scenarios.pageOverBudget!())
    expect(over.blocks?.[0]).toMatchObject({ id: 'rich-text', position: 1 })
    frontend.blockKb = 5

    // Its `position` counts the island blocks of the zone only (the check reads those alone), so the
    // admin finds the block by its id when the place does not hold it.
    const island = await refusal(await scenarios.islandAlternativeMissing!())
    expect(island.blocks).toHaveLength(1)
    expect(island.blocks?.[0]).toMatchObject({
      block: 'scene',
      fields: ['poster'],
      zone: 'sections',
    })

    const sample = await refusal(await scenarios.sampleTextPresent!())
    expect(sample.blocks).toEqual([
      { block: 'rich-text', position: 0, fields: ['body'], zone: 'sections' },
    ])

    const { data } = (await (await scenarios.linkToDraft!()).json()) as Answer
    const [warning] = data.warnings
    expect(warning).toMatchObject({
      type: 'about:blank',
      code: 'linkToDraft',
      blocks: [
        {
          block: 'cta',
          position: 1,
          field: 'primaryLink',
          path: '/pricing',
          zone: 'sections',
          page: { uid: BROCHURE, title: 'Pricing' },
        },
      ],
    })
    expect(warning!.detail).toContain('(Pricing)')
  })

  it('a link to a published page, an outside address or a page that does not exist is no warning', async () => {
    const plans = await page('Plans', [text('Plans.')])
    expect((await move(plans, 'in_review')).status).toBe(200)
    expect((await move(plans, 'published')).status).toBe(200)
    const documentId = await page('Links', [
      text('Welcome.'),
      cta('/plans'),
      cta('https://example.com/pricing'),
      cta('/nowhere'),
    ])
    const response = await move(documentId, 'in_review')
    expect(response.status).toBe(200)
    expect(((await response.json()) as Answer).data.warnings).toEqual([])
  })

  it('a dry run answers the warnings and writes nothing', async () => {
    await page('Offers', [text('Offers.')])
    const documentId = await page('Front', [cta('/offers')])
    const response = await move(documentId, 'in_review', { dryRun: true, note: 'Look' })
    expect(response.status).toBe(200)
    expect(((await response.json()) as Answer).data.warnings[0]?.code).toBe('linkToDraft')
    const draft = (await brochures().findOne({
      documentId,
      locale: 'en',
      populate: ['editorial'],
    } as never)) as unknown as { editorial: { state: string; note: string | null } }
    expect(draft.editorial).toMatchObject({ state: 'draft', note: null })
  })
})
