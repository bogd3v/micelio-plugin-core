import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'
import { startPreviewSite, type PreviewSite } from '../strapi/preview-site'

// A site-scoped, editorial page type with page settings, measured at publish (issue #57).
// The browser's own window, typed here: the root tsconfig has no DOM types.
interface Window {
  getComputedStyle(element: unknown): { getPropertyValue(name: string): string }
}

const BROCHURE = 'api::brochure.brochure'
const PASSWORD = 'Password1234'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

/** `expect.poll` with the time a save, a transition and a frame reload take. */
const eventually = <T>(read: () => Promise<T> | T) => expect.poll(read, { timeout: 20_000 })

// The seeded page: two blocks of text.
const SECTIONS = [
  { __component: 'section.rich-text', body: 'Open source, in plain words.' },
  { __component: 'section.rich-text', body: 'Hyphae connect the trees.' },
]

interface Editorial {
  state: string
  publishAt: string | null
  note: string | null
}

describe('the review flow in the builder', () => {
  let strapi: Core.Strapi
  let base: string
  let site: PreviewSite
  let browser: Browser
  let siteDocumentId = ''
  let superAdminId = 0
  let admins = 0
  const contexts: BrowserContext[] = []

  const brochures = () => strapi.documents(BROCHURE as UID.ContentType)

  async function seeded(title: string): Promise<string> {
    const created = await brochures().create({
      locale: 'en',
      data: {
        title,
        slug: title.toLowerCase().replace(/\W+/g, '-'),
        site: siteDocumentId,
        sections: SECTIONS,
      } as never,
    })
    return created.documentId
  }

  async function editorialOf(documentId: string): Promise<Editorial> {
    const draft = (await brochures().findOne({
      documentId,
      locale: 'en',
      status: 'draft',
      populate: ['editorial'],
    } as never)) as unknown as { editorial: Editorial }
    return draft.editorial
  }

  async function open(documentId: string): Promise<Page> {
    admins += 1
    const email = `review-${admins}@example.com`
    await strapi.service('admin::user').create({
      email,
      firstname: 'Review',
      lastname: 'Test',
      password: PASSWORD,
      roles: [superAdminId],
      isActive: true,
    })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      bypassCSP: true,
    })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto(`${base}/admin/auth/login`)
    await page.locator('input[name="email"]').fill(email)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL(/\/admin(?!\/auth)/)
    await page.goto(`${base}/admin/plugins/micelio/builder/${BROCHURE}/${documentId}?locale=en`)
    await page.locator('[data-block="rich-text"]').waitFor()
    return page
  }

  const stateBadge = (page: Page) => page.getByTestId('editorial-state').textContent()

  /** Waits for the animations that end (a dialog's fade-in): axe reads the colours as they are. */
  const settled = (page: Page) =>
    // A string: the suites' tsconfig has no DOM types.
    page.evaluate(
      'Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))).then(() => undefined)'
    )

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    strapi.config.set('plugin::micelio.budgets', {
      ...strapi.config.get<Record<string, unknown>>('plugin::micelio.budgets'),
      contentTypes: [BROCHURE],
    })
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    site = await startPreviewSite()
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    siteDocumentId = ((await sites.findFirst()) as { documentId: string }).documentId
    await sites.update({ documentId: siteDocumentId, data: { url: site.origin } as never })
    const apiToken = (await strapi.service('admin::api-token').create({
      name: 'review-test',
      type: 'custom',
      lifespan: null,
      permissions: ['plugin::micelio.preview.exchange', 'plugin::micelio.preview.draft'],
    })) as { accessKey: string }
    site.connect({ base, apiToken: apiToken.accessKey, adminOrigin: base })
    superAdminId = (
      (await strapi.db.query('admin::role').findOne({
        where: { code: 'strapi-super-admin' },
      })) as { id: number }
    ).id
    browser = await chromium.launch()
  })

  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close()
  })

  afterAll(async () => {
    await browser?.close()
    await site?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
  })

  it('draft, in review, published on the seeded page', async () => {
    const documentId = await seeded('Launch')
    const page = await open(documentId)
    expect(await stateBadge(page)).toBe('Draft')

    // Send to review: the dialog runs the server's checks first, then sends with the note.
    await page.getByRole('button', { name: 'Send to review' }).click()
    const dialog = page.getByRole('dialog', { name: 'Send to review' })
    await dialog.getByText('Every island has its static alternative').waitFor()
    expect(await dialog.getByText('All required fields filled').count()).toBe(1)
    // The reviewers' hint names the site by its name, not its slug.
    expect(
      await dialog
        .getByText('The reviewers of Micelio find the page on the In review page.')
        .count()
    ).toBe(1)
    await settled(page)
    const axe = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(WCAG_TAGS)
      .analyze()
    expect(axe.violations.map(({ id }) => id)).toEqual([])
    await dialog.getByLabel(/Note for the reviewer/).fill('The intro is new')
    await dialog.getByRole('button', { name: 'Send to review' }).click()
    await eventually(() => stateBadge(page)).toBe('In review')
    expect(await editorialOf(documentId)).toMatchObject({
      state: 'in_review',
      note: 'The intro is new',
    })

    // The In review page lists it; the builder approves it, and the frontend measures it first.
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await eventually(() => stateBadge(page)).toBe('Published')
    expect(await editorialOf(documentId)).toMatchObject({ state: 'published' })
    expect(
      await brochures().findOne({ documentId, locale: 'en', status: 'published' } as never)
    ).not.toBeNull()
    // The page took the version the transition wrote: no conflict notice, and it saves as before.
    expect(await page.getByText('This page was saved somewhere else').count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Unpublish' }).count()).toBe(1)
  })

  it('the schedule resets after an edit', async () => {
    const documentId = await seeded('Later')
    const page = await open(documentId)

    await page.getByRole('button', { name: 'Schedule', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Schedule publication' })
    await dialog.getByLabel('Time').fill('09:30')
    await dialog.getByRole('button', { name: 'Schedule', exact: true }).click()
    await eventually(() => stateBadge(page)).toBe('Scheduled')
    const scheduled = await editorialOf(documentId)
    expect(scheduled.state).toBe('scheduled')
    expect(new Date(scheduled.publishAt!).getTime()).toBeGreaterThan(Date.now())

    // An edit: the server moves the page back to draft, and the builder says so.
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]')
      .first()
      .click()
    await page.getByLabel('Body').fill('A new opening line.')
    await eventually(() => page.getByTestId('save-status').textContent()).toContain('Saved')
    await eventually(() => stateBadge(page)).toBe('Draft')
    await page.getByText('Back to draft', { exact: true }).waitFor()
    expect(await editorialOf(documentId)).toMatchObject({ state: 'draft', publishAt: null })

    // "Schedule again" opens the dialog.
    await page.getByRole('button', { name: 'Schedule again' }).click()
    await page.getByRole('dialog', { name: 'Schedule publication' }).waitFor()
  })

  it('shows a refusal as a notification with a link to the block', async () => {
    const documentId = await seeded('Too heavy')
    site.weight.blockKb = 400
    try {
      const page = await open(documentId)
      await page.getByRole('button', { name: 'Send to review' }).click()
      await page
        .getByRole('dialog', { name: 'Send to review' })
        .getByRole('button', { name: 'Send to review' })
        .click()
      await eventually(() => stateBadge(page)).toBe('In review')
      await page.getByRole('button', { name: 'Publish', exact: true }).click()
      const alert = page.getByRole('alert').filter({ hasText: 'Not published: over budget' })
      await alert.waitFor()
      expect(await alert.textContent()).toContain('Heaviest blocks: rich-text')
      const link = alert.getByRole('link', { name: 'Go to the block' })
      expect(await link.getAttribute('href')).toBe(
        `/admin/plugins/micelio/builder/${BROCHURE}/${documentId}?locale=en&block=rich-text&position=0`
      )
      expect(await editorialOf(documentId)).toMatchObject({ state: 'in_review' })
      // The link opens the builder with that block selected.
      await page.goto(`${base}${await link.getAttribute('href')}`)
      await page.getByRole('complementary', { name: 'Selected block' }).waitFor()
      expect(await page.getByLabel('Body').inputValue()).toBe(SECTIONS[0]!.body)
    } finally {
      site.weight.blockKb = 5
    }
  })

  it('the In review page approves a page and sends one back with a note', async () => {
    const approve = await seeded('Approve me')
    const back = await seeded('Send me back')
    for (const documentId of [approve, back]) {
      const response = await strapi
        .plugin('micelio')
        .service('transitions')
        .perform({
          uid: BROCHURE,
          documentId,
          locale: 'en',
          to: 'in_review',
          note: 'Please look',
          actor: { kind: 'user', id: 1, roles: ['strapi-super-admin'] },
        })
      expect(response.to).toBe('in_review')
    }
    const page = await open(approve)
    await page.goto(`${base}/admin/plugins/micelio/review`)
    await page.getByRole('heading', { level: 1, name: 'In review' }).waitFor()
    await page.getByRole('row', { name: /Approve me/ }).waitFor()
    expect(await page.getByRole('row', { name: /Send me back/ }).textContent()).toContain(
      'Please look'
    )
    await settled(page)
    const axe = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
    expect(axe.violations.map(({ id }) => id)).toEqual([])
    // The title links to the builder in the theme's primary colour, the one of the Approve button,
    // never the browser's default blue.
    const colour = (locator: Locator, property: string) =>
      locator.evaluate(
        (element, name) =>
          (globalThis as unknown as Window).getComputedStyle(element).getPropertyValue(name),
        property
      )
    const title = page.getByRole('link', { name: 'Approve me' })
    expect(await title.getAttribute('href')).toBe(
      `/admin/plugins/micelio/builder/${BROCHURE}/${approve}?locale=en`
    )
    expect(await colour(title.getByText('Approve me'), 'color')).toBe(
      await colour(
        page.getByRole('button', { name: 'Approve and publish Approve me' }),
        'background-color'
      )
    )

    await page.getByRole('button', { name: 'Approve and publish Approve me' }).click()
    await eventually(async () => (await editorialOf(approve)).state).toBe('published')

    await page.getByRole('button', { name: 'Send back Send me back' }).click()
    const dialog = page.getByRole('dialog', { name: 'Send back to the editor' })
    await dialog.getByLabel('Note for the editor').fill('Shorten the intro')
    await dialog.getByRole('button', { name: 'Send back' }).click()
    await eventually(() => editorialOf(back)).toMatchObject({
      state: 'draft',
      note: 'Shorten the intro',
    })
    await page.getByRole('row', { name: /Send me back/ }).waitFor({ state: 'detached' })
    expect(await page.getByRole('row', { name: /Approve me/ }).count()).toBe(0)

    // The editor finds the note in the builder.
    await page.goto(`${base}/admin/plugins/micelio/builder/${BROCHURE}/${back}?locale=en`)
    await page.getByText('Sent back with a note').waitFor()
    expect(await page.getByText('Shorten the intro').count()).toBe(1)
  })
})
