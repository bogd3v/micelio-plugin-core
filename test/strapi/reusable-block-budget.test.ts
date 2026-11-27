import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import type { PluginConfig } from '../../server/src/config'
import { EDITORIAL_COMPONENT_UID } from '../../server/src/constants/editorial'
import { REUSABLE_BLOCK_UID } from '../../server/src/constants/reusable-blocks'
import { SITE_UID } from '../../server/src/constants/site'
import type { Actor } from '../../server/src/editorial/machine'
import type { TransitionError } from '../../server/src/editorial/transitions'
import type { TransitionsService } from '../../server/src/services/transitions'
import { cleanupStrapi, setupStrapi } from './harness'
import { startWeightSite, type WeightSite } from './weight-site'

// The page fixture (test/strapi/app/src/api/page/) references reusable blocks through its
// `section.reusable` component. This suite makes it editorial (`MICELIO_TEST_EDITORIAL_PAGE`) and
// lists it in the budgets while it runs, so a page's publish and a reusable block's are measured;
// the stub frontend weighs each block of a page by its catalogue id (`reusable` for a reference).
// The test app's scheduler runs every second; this suite turns it off (`MICELIO_TEST_SCHEDULER_OFF`),
// so that only its own `publishDue` calls publish the entry it makes due.
const PAGE = 'api::page.page' as UID.ContentType
const REUSABLE = REUSABLE_BLOCK_UID as UID.ContentType
const PASSWORD = 'Password1234'
/** The budget of a `standard` page, in kB (`server/src/constants/budget.ts`). */
const STANDARD_KB = 120

const cta = (title: string) => ({ __component: 'section.cta', title })
/** A block of the page's own; the stub weighs it as `rich-text`. */
const prose = (body: string) => ({ __component: 'section.rich-text', body })
const reference = (documentId: string) => ({
  __component: 'section.reusable',
  reusableBlock: documentId,
})

// The publish of a reusable block measures the published pages that show it (#262; ADR-0019 and
// ADR-0022, amendments of 2026-11-23).
describe('the budget at the publish of a reusable block', { timeout: 60_000 }, () => {
  process.env.MICELIO_TEST_EDITORIAL_PAGE = 'true'
  process.env.MICELIO_TEST_SCHEDULER_OFF = 'true'

  let strapi: Core.Strapi
  let base: string
  let site: string
  let frontend: WeightSite
  let admin: Actor
  let adminToken: string
  const configured = () => strapi.config.get<PluginConfig['budgets']>('plugin::micelio.budgets')
  const transitions = () => strapi.plugin('micelio').service('transitions') as TransitionsService
  const reusables = () => strapi.documents(REUSABLE)
  const pages = () => strapi.documents(PAGE)

  const move = (uid: string, documentId: string, to: string, locale = 'en') =>
    transitions().perform({
      uid,
      documentId,
      locale,
      to: to as never,
      actor: admin,
      ...(to === 'scheduled' ? { publishAt: new Date(Date.now() + 3_600_000) } : {}),
    })

  async function publish(uid: string, documentId: string, locale = 'en'): Promise<void> {
    for (const to of ['in_review', 'published']) await move(uid, documentId, to, locale)
  }

  async function createBlock(title: string): Promise<string> {
    const created = await reusables().create({
      locale: 'en',
      data: { name: title, blocks: [cta(title)], site } as never,
    })
    return created.documentId
  }

  const saveBlock = (documentId: string, title: string, locale = 'en') =>
    reusables().update({ documentId, locale, data: { name: title, blocks: [cta(title)] } as never })

  /** A page that shows the block, published (and measured, within its budget) unless `draft`. */
  async function createPage(
    slug: string,
    sections: unknown[],
    options: { draft?: boolean; locale?: string; documentId?: string } = {}
  ): Promise<string> {
    const locale = options.locale ?? 'en'
    const data = { title: slug, slug, sections, site } as never
    const documentId = options.documentId
      ? (await pages().update({ documentId: options.documentId, locale, data }), options.documentId)
      : (await pages().create({ locale, data })).documentId
    if (!options.draft) await publish(PAGE, documentId, locale)
    return documentId
  }

  /** A published block and the published pages that show it; the requests start empty. */
  async function blockOn(...slugs: string[]): Promise<{ block: string; pages: string[] }> {
    const block = await createBlock(`Banner of ${slugs.join(' ')}`)
    await publish(REUSABLE, block)
    const shown: string[] = []
    for (const slug of slugs) shown.push(await createPage(slug, [reference(block)]))
    frontend.requests.length = 0
    return { block, pages: shown }
  }

  /** What a call refused with: its code, status and members. */
  async function refusal(work: Promise<unknown>) {
    try {
      await work
    } catch (error) {
      const { code, status, extensions } = error as TransitionError
      return { code, status, ...extensions }
    }
    throw new Error('The transition was not refused')
  }

  const publishedTitle = async (block: string) => {
    const live = (await reusables().findOne({
      documentId: block,
      locale: 'en',
      status: 'published',
      populate: { blocks: true },
    } as never)) as { blocks?: { title?: string }[] } | null
    return live?.blocks?.[0]?.title
  }

  const stateOf = async (block: string) =>
    (
      (await reusables().findOne({
        documentId: block,
        locale: 'en',
        status: 'draft',
        populate: { editorial: true },
      } as never)) as { editorial?: { state?: string } } | null
    )?.editorial?.state

  /** The `documentId`s of the pages the frontend was asked to weigh, in order. */
  const measured = () => frontend.requests.map((request) => request.path.split('/')[4])

  const pageRows = () =>
    strapi.db.query(PAGE).findMany({
      select: ['id', 'documentId', 'locale', 'updatedAt', 'publishedAt', 'title'],
      orderBy: { id: 'asc' },
    })

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const row = (await strapi.documents(SITE_UID as UID.ContentType).findFirst({}))!
    site = row.documentId
    await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' })
    const apiToken = (
      (await strapi.service('admin::api-token').create({
        name: 'reusable-block-budget-suite',
        type: 'full-access',
        lifespan: null,
      })) as { accessKey: string }
    ).accessKey
    frontend = await startWeightSite({ base, apiToken, siteSlug: row.slug as string })
    await strapi
      .documents(SITE_UID as UID.ContentType)
      .update({ documentId: site, data: { url: frontend.origin } as never })
    strapi.config.set('plugin::micelio.budgets', { ...configured(), contentTypes: [PAGE] })
    const role = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    const email = 'reusable-budget@example.com'
    const user = (await strapi.service('admin::user').create({
      email,
      firstname: 'Re',
      lastname: 'Budget',
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
    })) as { id: number }
    admin = { kind: 'user', id: user.id, roles: ['strapi-super-admin'] }
    const login = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    adminToken = ((await login.json()) as { data: { token: string } }).data.token
  })

  afterAll(async () => {
    await frontend?.close()
    await cleanupStrapi()
    delete process.env.MICELIO_TEST_EDITORIAL_PAGE
    delete process.env.MICELIO_TEST_SCHEDULER_OFF
  })

  beforeEach(() => {
    // Every block weighs 5 kB, a page 10 kB more: far within the 120 kB of a standard page.
    frontend.queue = []
    frontend.blockKb = 5
    frontend.onRender = undefined
    frontend.beforeRead = undefined
    strapi.config.set('plugin::micelio.budgets', { ...configured(), contentTypes: [PAGE] })
  })

  it('refuses to publish a reusable block with pageOverBudget naming the published page it would put over its budget', async () => {
    const block = await createBlock('Banner')
    await publish(REUSABLE, block)
    const light = await createPage('light', [reference(block)])
    const heavy = await createPage('heavy', [reference(block), prose('One'), prose('Two')])
    await saveBlock(block, 'Banner, heavier')
    // The reference weighs 60 kB and each own block 40: the light page 60, the heavy one 140.
    frontend.blockKb = { reusable: 60, 'rich-text': 40 }
    frontend.requests.length = 0

    const answer = await fetch(`${base}/micelio/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ uid: REUSABLE, documentId: block, locale: 'en', to: 'published' }),
    })
    expect(answer.status).toBe(409)
    expect(await answer.json()).toMatchObject({
      status: 409,
      code: 'pageOverBudget',
      pageType: 'standard',
      budgetKb: STANDARD_KB,
      blocksKb: 140,
      overByKb: 20,
      // Heaviest first, at their 1-based positions.
      blocks: [
        { position: 1, id: 'reusable', kb: 60 },
        { position: 2, id: 'rich-text', kb: 40 },
        { position: 3, id: 'rich-text', kb: 40 },
      ],
      page: { uid: PAGE, documentId: heavy, locale: 'en', title: 'heavy' },
    })
    expect(new Set(measured())).toEqual(new Set([light, heavy]))
    expect(await publishedTitle(block)).toBe('Banner')
    expect(await stateOf(block)).toBe('published')
  })

  it('publishes a reusable block when every published page that shows it stays within its budget, and edits none of them', async () => {
    const { block, pages: shown } = await blockOn('first', 'second', 'third')
    await saveBlock(block, 'Banner, edited')
    const before = await pageRows()

    await move(REUSABLE, block, 'published')

    expect(measured().sort()).toEqual([...shown].sort())
    expect(await publishedTitle(block)).toBe('Banner, edited')
    expect(await pageRows()).toEqual(before)
  })

  it('measures only the published pages of measured types in the locale published', async () => {
    const block = await createBlock('Banner')
    await saveBlock(block, 'Banner en español', 'es')
    await publish(REUSABLE, block)
    await publish(REUSABLE, block, 'es')
    const live = await createPage('live', [reference(block)])
    // Draft only: its own publish measures it.
    await createPage('draft-only', [reference(block)], { draft: true })
    // Published without the block; its draft shows it since.
    const later = await createPage('later', [prose('Own')])
    await pages().update({
      documentId: later,
      locale: 'en',
      data: { sections: [reference(block)] } as never,
    })
    // The same page in Spanish, showing the Spanish block.
    await createPage('en-vivo', [reference(block)], { locale: 'es', documentId: live })
    frontend.requests.length = 0

    await move(REUSABLE, block, 'published')
    expect(measured()).toEqual([live])
    expect(frontend.requests[0]!.query.locale).toBe('en')

    frontend.requests.length = 0
    await move(REUSABLE, block, 'published', 'es')
    expect(measured()).toEqual([live])
    expect(frontend.requests[0]!.query.locale).toBe('es')

    // A type the budgets do not list is not measured.
    frontend.requests.length = 0
    strapi.config.set('plugin::micelio.budgets', { ...configured(), contentTypes: [] })
    await move(REUSABLE, block, 'published')
    expect(frontend.requests).toEqual([])
  })

  it('refuses with previewUnavailable naming the page the frontend could not measure', async () => {
    const { block, pages: shown } = await blockOn('unmeasurable')
    await saveBlock(block, 'Banner, edited')
    frontend.queue = [{ status: 500 }]

    expect(await refusal(move(REUSABLE, block, 'published'))).toMatchObject({
      status: 409,
      code: 'previewUnavailable',
      page: { uid: PAGE, documentId: shown[0], locale: 'en', title: 'unmeasurable' },
    })
    expect(await publishedTitle(block)).toBe('Banner of unmeasurable')
  })

  it('refuses with previewUnavailable naming a page unpublished while the pages are measured', async () => {
    // Measured two at a time in the order of their titles: the third waits for the first two.
    const { block, pages: shown } = await blockOn('race-a', 'race-b', 'race-c')
    await saveBlock(block, 'Banner, raced')
    frontend.beforeRead = async () => {
      frontend.beforeRead = undefined
      await move(PAGE, shown[2]!, 'draft')
    }

    expect(await refusal(move(REUSABLE, block, 'published'))).toEqual({
      status: 409,
      code: 'previewUnavailable',
      page: { uid: PAGE, documentId: shown[2], locale: 'en', title: 'race-c' },
    })
    expect(measured().sort()).toEqual([shown[0], shown[1]].sort())
    expect(await publishedTitle(block)).toBe('Banner of race-a race-b race-c')
  })

  it("refuses when the reusable block's draft is saved while its pages are measured", async () => {
    const { block } = await blockOn('saved-while-measured')
    await saveBlock(block, 'Banner, measured')
    frontend.onRender = async () => {
      frontend.onRender = undefined
      await saveBlock(block, 'Banner, saved meanwhile')
    }

    expect(await refusal(move(REUSABLE, block, 'published'))).toMatchObject({
      status: 409,
      code: 'previewUnavailable',
    })
    expect(frontend.requests).toHaveLength(1)
    expect(await publishedTitle(block)).toBe('Banner of saved-while-measured')
  })

  it('a scheduled reusable block that would put a page over its budget stays scheduled', async () => {
    const { block } = await blockOn('scheduled-page')
    await saveBlock(block, 'Banner, scheduled')
    // A block is scheduled only from draft, and unpublishing it drops the links of the published
    // pages to it (Strapi), so the transitions never schedule a block a published page shows. The
    // draft's state is set here as the scheduler would find it: what is tested is its publish.
    const draft = (await reusables().findOne({
      documentId: block,
      locale: 'en',
      status: 'draft',
      populate: { editorial: true },
    } as never)) as unknown as { editorial: { id: number } }
    await strapi.db.query(EDITORIAL_COMPONENT_UID as never).update({
      where: { id: draft.editorial.id },
      data: { state: 'scheduled', publishAt: new Date(Date.now() - 1000) },
    })
    frontend.blockKb = { reusable: 200 }

    expect(await transitions().publishDue()).toBe(0)
    expect(measured()).toHaveLength(1)
    expect(await stateOf(block)).toBe('scheduled')
    expect(await publishedTitle(block)).toBe('Banner of scheduled-page')

    frontend.blockKb = 5
    expect(await transitions().publishDue()).toBe(1)
    expect(await stateOf(block)).toBe('published')
    expect(await publishedTitle(block)).toBe('Banner, scheduled')
  })

  it('unpublishing a reusable block measures nothing', async () => {
    const { block } = await blockOn('unpublished-block')
    frontend.blockKb = { reusable: 200 }

    await move(REUSABLE, block, 'draft')

    expect(frontend.requests).toEqual([])
    expect(await publishedTitle(block)).toBeUndefined()
  })

  it('marks the weight request of each page measured with measure=reference', async () => {
    const { block, pages: shown } = await blockOn('marked-one', 'marked-two')
    await saveBlock(block, 'Banner, marked')

    await move(REUSABLE, block, 'published')

    expect(frontend.requests).toHaveLength(2)
    for (const request of frontend.requests) {
      expect(request.query).toEqual({ mode: 'dynamic', locale: 'en', measure: 'reference' })
      expect(request.via).toBe('header')
    }
    expect(measured().sort()).toEqual([...shown].sort())
    // A page's own publish is not marked.
    frontend.requests.length = 0
    await createPage('own-publish', [prose('Own')])
    expect(frontend.requests.map((request) => request.query)).toEqual([
      { mode: 'dynamic', locale: 'en' },
    ])
  })
})
