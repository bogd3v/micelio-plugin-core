import { describe, expect, it } from 'vitest'
import AxeBuilder from '@axe-core/playwright'
import type { Locator, Page } from 'playwright'
import { SITE_UID } from '../../server/src/constants/site'
import { BROCHURE_UID, WCAG_TAGS, eventually, useBuilderSession } from './builder-session'

// An editorial page with page settings, a `seo` component and a hero (test/strapi/app/src/api/leaflet/).
const LEAFLET_UID = 'api::leaflet.leaflet'
const TITLE = 'Open source, in plain words'
const BODY =
  'A plain-words guide to what open source is, what it is not, and why it matters to anyone who uses software.'
const SECTIONS = [{ __component: 'section.rich-text', body: BODY }]

describe('the SEO and social tab of the page settings in the builder', () => {
  const session = useBuilderSession()

  /** Waits for a line of text of the locator, as these suites read the page (no Playwright matchers). */
  const textOf = (locator: Locator) => eventually(() => locator.first().textContent())
  const valueOf = (locator: Locator) => eventually(() => locator.inputValue())
  const shown = (locator: Locator) => locator.first().waitFor()

  const drawer = (page: Page) => page.getByRole('dialog', { name: 'Page settings' })

  async function openSeoTab(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Page settings' }).click()
    await drawer(page).getByRole('tab', { name: 'SEO and social' }).click()
  }

  async function seoOf(documentId: string) {
    const draft = (await session.strapi.documents(LEAFLET_UID as never).findOne({
      documentId,
      locale: 'en',
      status: 'draft',
      populate: { seo: { populate: ['metaImage'] } },
    } as never)) as unknown as {
      seo: {
        id: number
        metaTitle: string | null
        metaDescription: string | null
        metaImage: { width: number; height: number; alternativeText: string | null } | null
      } | null
    }
    return draft.seo
  }

  it('the tab on the seeded page shows the derived title', async () => {
    const siteName = (
      (await session.strapi.documents(SITE_UID as never).findFirst()) as unknown as { name: string }
    ).name
    const documentId = await session.seed(LEAFLET_UID, SECTIONS, TITLE)
    const page = await session.open(LEAFLET_UID, documentId)
    await openSeoTab(page)
    const title = drawer(page).getByLabel('Meta title')
    await valueOf(title).toBe(`${TITLE} · ${siteName}`)
    await textOf(drawer(page).getByTestId(/-title-counter$/)).toBe(
      `${TITLE.length + siteName.length + 3} / 60`
    )
    // The description starts from the first paragraph, and the search result shows both.
    await valueOf(drawer(page).getByLabel('Meta description')).toBe(BODY)
    await textOf(drawer(page).getByTestId('seo-preview-search')).toContain(TITLE)
    await drawer(page).getByRole('button', { name: 'Link card' }).click()
    await textOf(drawer(page).getByTestId('seo-preview-card')).toContain(BODY)
    await drawer(page).getByRole('button', { name: 'Fediverse' }).click()
    await textOf(drawer(page).getByTestId('seo-preview-fediverse')).toContain(`New on ${siteName}`)
    // The checks say what is missing: the page has no image yet.
    await shown(drawer(page).getByText('The social image is missing.'))
  })

  it('over 160 the counter warns and the save still works', async () => {
    const documentId = await session.seed(LEAFLET_UID, SECTIONS, TITLE)
    const page = await session.open(LEAFLET_UID, documentId)
    await openSeoTab(page)
    const description = drawer(page).getByLabel('Meta description')
    const long = `${BODY} ${BODY}`.slice(0, 170)
    await description.fill(long)
    await textOf(drawer(page).getByTestId(/-description-counter$/)).toContain('170 / 160: 10 over')
    // Leaving the field saves it: the counter warns and never holds the save.
    await drawer(page).getByLabel('Meta title').focus()
    await eventually(async () => (await seoOf(documentId))?.metaDescription).toBe(long)
    await shown(drawer(page).getByText('Saved'))
    await shown(drawer(page).getByText('The meta description is over 160 characters.'))
  })

  it('Generate from title stores the card as the social image', async () => {
    const documentId = await session.seed(LEAFLET_UID, SECTIONS, TITLE)
    const page = await session.open(LEAFLET_UID, documentId)
    // The frame loaded: the stub frontend gave the editor its preview grant, which the card needs.
    await eventually(() => session.site.draftLoads).toBeGreaterThan(0)
    await openSeoTab(page)
    const before = session.site.cardRequests.length
    await drawer(page).getByRole('button', { name: 'Generate from title' }).click()
    await eventually(async () => (await seoOf(documentId))?.metaImage?.width).toBe(1200)
    const image = (await seoOf(documentId))?.metaImage
    expect(image).toMatchObject({ width: 1200, height: 630, alternativeText: TITLE })
    expect(session.site.cardRequests.slice(before)).toEqual([
      { uid: LEAFLET_UID, documentId, grant: expect.any(String) },
    ])
    await textOf(drawer(page).getByTestId('seo-image-caption')).toContain('1200×630')
    await shown(drawer(page).getByText('Social image present, 1200×630'))
  })

  it('has no axe violations, with the advanced fields open', async () => {
    const documentId = await session.seed(LEAFLET_UID, SECTIONS, TITLE)
    const page = await session.open(LEAFLET_UID, documentId)
    await openSeoTab(page)
    await drawer(page).getByText('Advanced').click()
    await textOf(drawer(page).getByTestId('seo-jsonld')).toContain('"@type": "WebPage"')
    const results = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
    expect(results.violations.map(({ id }) => id)).toEqual([])
  })

  it('saves hand-written structured data and says what is not JSON-LD', async () => {
    const documentId = await session.seed(LEAFLET_UID, SECTIONS, TITLE)
    const page = await session.open(LEAFLET_UID, documentId)
    await openSeoTab(page)
    await drawer(page).getByText('Advanced').click()
    const sent: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.postData()?.includes('structuredData')) {
        sent.push(request.postData() ?? '')
      }
    })
    const own = drawer(page).getByLabel('Your own JSON-LD')
    await own.fill('{"@type": "Article"}')
    await drawer(page).getByLabel('Keywords').focus()
    await textOf(drawer(page).getByRole('alert')).toContain('"@context"')
    // The tab says it before it asks: nothing is sent for what is not JSON-LD.
    expect(sent).toEqual([])
    const valid = '{"@context": "https://schema.org", "@type": "Article", "headline": "Hi"}'
    await own.fill(valid)
    await drawer(page).getByLabel('Keywords').focus()
    await eventually(async () => {
      const draft = (await session.strapi.documents(LEAFLET_UID as never).findOne({
        documentId,
        locale: 'en',
        status: 'draft',
        populate: ['seo'],
      } as never)) as unknown as { seo: { structuredData: unknown } }
      return draft.seo.structuredData
    }).toEqual(JSON.parse(valid))
    await textOf(drawer(page).getByTestId('seo-jsonld')).toContain('"headline": "Hi"')
  })

  it('a page type without the seo component has no SEO tab', async () => {
    const documentId = await session.seed(BROCHURE_UID, [], 'No seo here')
    const page = await session.open(BROCHURE_UID, documentId)
    await page.getByRole('button', { name: 'Page settings' }).click()
    await drawer(page).getByRole('tab', { name: 'General' }).waitFor()
    expect(await drawer(page).getByRole('tab').allTextContents()).toEqual(['General', 'Template'])
  })

  it('opening the tab saves the defaults of a page that was saved before the plugin', async () => {
    const documentId = await session.seed(LEAFLET_UID, SECTIONS, TITLE)
    // A page saved before the plugin has no title or description of its own.
    const stored = await seoOf(documentId)
    expect(stored?.metaTitle).not.toBeNull()
    await session.strapi.db.query('shared.seo' as never).update({
      where: { id: stored?.id },
      data: { metaTitle: null, metaDescription: null },
    } as never)
    const page = await session.open(LEAFLET_UID, documentId)
    await openSeoTab(page)
    await valueOf(drawer(page).getByLabel('Meta description')).toBe(BODY)
    await eventually(async () => (await seoOf(documentId))?.metaDescription).toBe(BODY)
    expect((await seoOf(documentId))?.metaTitle).toMatch(new RegExp(`^${TITLE} · `))
  })

  it('opening the tab of a scheduled page leaves it scheduled', async () => {
    const documentId = await session.seed(LEAFLET_UID, SECTIONS, TITLE)
    // The page is complete (the checks before review read what the server holds), then scheduled.
    const file = (await session.strapi.db.query('plugin::upload.file').create({
      data: {
        name: 'card.png',
        hash: 'card_scheduled',
        ext: '.png',
        mime: 'image/png',
        size: 1,
        url: '/uploads/card_scheduled.png',
        provider: 'local',
        width: 1200,
        height: 630,
      },
    })) as { id: number }
    await session.strapi.documents(LEAFLET_UID as never).update({
      documentId,
      locale: 'en',
      data: { seo: { metaTitle: TITLE, metaDescription: BODY, metaImage: file.id } },
    } as never)
    const scheduled = (await session.strapi
      .plugin('micelio')
      .service('transitions')
      .perform({
        uid: LEAFLET_UID,
        documentId,
        locale: 'en',
        to: 'scheduled',
        publishAt: new Date(Date.now() + 86_400_000).toISOString(),
        actor: { kind: 'user', id: 1, roles: ['strapi-super-admin'] },
      })) as { to: string }
    expect(scheduled.to).toBe('scheduled')
    await session.strapi.db.query('shared.seo' as never).update({
      where: { id: (await seoOf(documentId))?.id },
      data: { metaDescription: null },
    } as never)
    const page = await session.open(LEAFLET_UID, documentId)
    const writes: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'PUT') writes.push(request.url())
    })
    await openSeoTab(page)
    await valueOf(drawer(page).getByLabel('Meta description')).toBe(BODY)
    await page.waitForLoadState('networkidle')
    // Opening the tab sent no save, so the page is still scheduled, not moved back to draft.
    expect(writes).toEqual([])
    const draft = (await session.strapi.documents(LEAFLET_UID as never).findOne({
      documentId,
      locale: 'en',
      status: 'draft',
      populate: ['editorial'],
    } as never)) as unknown as { editorial: { state: string } }
    expect(draft.editorial.state).toBe('scheduled')
  })
})
