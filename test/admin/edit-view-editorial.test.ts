import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
import en from '../../admin/src/translations/en.json'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'

// Fixture types (test/strapi/app/src/api/): `memo` is site-scoped and editorial with no dynamic
// zone, so the builder does not open it and the panel is the only place to move it; `landing` is
// editorial with a zone, which the builder opens (and no budget, so it publishes without a
// frontend); `page` is site-scoped with a zone and is not editorial.
const MEMO_UID = 'api::memo.memo'
const LANDING_UID = 'api::landing.landing'
const PAGE_UID = 'api::page.page'
const PASSWORD = 'Password1234'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

/** `expect.poll` with the time a save, a transition and a refetch take. */
const eventually = <T>(read: () => Promise<T> | T) => expect.poll(read, { timeout: 20_000 })

interface Editorial {
  state: string
  note: string | null
}

describe('the editorial panel in the edit view', () => {
  let strapi: Core.Strapi
  let base: string
  let browser: Browser
  let siteDocumentId = ''
  let superAdminId = 0
  let admins = 0
  let adminId = 0
  const contexts: BrowserContext[] = []

  const memos = () => strapi.documents(MEMO_UID as UID.ContentType)

  async function seeded(title: string): Promise<string> {
    const created = await memos().create({
      data: {
        title,
        slug: title.toLowerCase().replace(/\W+/g, '-'),
        site: siteDocumentId,
      } as never,
    })
    return created.documentId
  }

  async function editorialOf(documentId: string): Promise<Editorial> {
    const draft = (await memos().findOne({
      documentId,
      status: 'draft',
      populate: ['editorial'],
    } as never)) as unknown as { editorial: Editorial }
    return draft.editorial
  }

  /** A logged-in page of a context of its own, at the edit view of the entry. */
  async function open(uid: string, documentId: string, locale?: string): Promise<Page> {
    admins += 1
    const email = `editorial-${admins}@example.com`
    const user = (await strapi.service('admin::user').create({
      email,
      firstname: 'Editorial',
      lastname: 'Test',
      password: PASSWORD,
      roles: [superAdminId],
      isActive: true,
    })) as { id: number }
    adminId = user.id
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto(`${base}/admin/auth/login`)
    await page.locator('input[name="email"]').fill(email)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL(/\/admin(?!\/auth)/)
    const query = locale ? `?plugins[i18n][locale]=${locale}` : ''
    await page.goto(`${base}/admin/content-manager/collection-types/${uid}/${documentId}${query}`)
    return page
  }

  /** The panel's container: Strapi puts each panel of the side in a box with its title as a heading. */
  const panelOf = (page: Page): Locator =>
    page
      .locator('aside, div')
      .filter({
        has: page.getByRole('heading', { name: en['editorial.panel.title'], exact: true }),
      })
      .last()

  const stepsOf = (page: Page) => page.getByRole('list', { name: en['editorial.panel.steps'] })

  /** Waits for the animations that end (a dialog's fade-in): axe reads the colours as they are. */
  const settled = (page: Page) =>
    page.evaluate(
      'Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))).then(() => undefined)'
    )

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    siteDocumentId = (
      (await strapi.documents(SITE_UID as UID.ContentType).findFirst()) as { documentId: string }
    ).documentId
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
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
  })

  it('shows the editorial panel on an editorial entry and not on another type', async () => {
    const memoId = await seeded('Plain memo')
    const memo = await open(MEMO_UID, memoId)
    await memo.getByRole('heading', { name: 'Plain memo' }).waitFor()
    const panel = panelOf(memo)
    await panel.getByRole('heading', { name: en['editorial.panel.title'] }).waitFor()
    // The steps, with the current one marked, and the buttons of a draft, the primary one first.
    const steps = await stepsOf(memo).getByRole('listitem').allTextContents()
    expect(steps).toEqual(['Draft', 'In review', 'Published'])
    expect(await stepsOf(memo).getByRole('listitem').first().getAttribute('aria-current')).toBe(
      'step'
    )
    const buttons = await panel.getByRole('button').allTextContents()
    expect(buttons).toEqual(['Send to review', 'Schedule'])
    // A type with no builder has no link to it.
    await expect(
      panel.getByRole('link', { name: en['editorial.panel.builder'] }).count()
    ).resolves.toBe(0)

    // A type the builder opens has the link, to the builder of that entry.
    const landing = await strapi.documents(LANDING_UID as UID.ContentType).create({
      locale: 'en',
      data: { title: 'A landing', site: siteDocumentId } as never,
    })
    const withBuilder = await open(LANDING_UID, landing.documentId, 'en')
    const link = panelOf(withBuilder).getByRole('link', { name: en['editorial.panel.builder'] })
    await link.waitFor()
    expect(await link.getAttribute('href')).toBe(
      `/admin/plugins/micelio/builder/${LANDING_UID}/${landing.documentId}?locale=en`
    )

    // The panel is registered before the cost panel: it comes first in the side.
    const editorialTop = await panelOf(withBuilder)
      .getByRole('heading', { name: en['editorial.panel.title'] })
      .boundingBox()
    const costTop = await withBuilder.getByRole('heading', { name: en['cost.title'] }).boundingBox()
    expect(editorialTop!.y).toBeLessThan(costTop!.y)

    // A type with a zone and a site that is not editorial has no panel.
    const site = await strapi.documents(PAGE_UID as UID.ContentType).create({
      data: { title: 'Landing page', slug: 'landing-page', site: siteDocumentId } as never,
    })
    const other = await open(PAGE_UID, site.documentId, 'en')
    await other.getByRole('heading', { name: 'Landing page' }).waitFor()
    await other.getByRole('heading', { name: 'Entry', exact: true }).waitFor()
    await expect(
      other.getByRole('heading', { name: en['editorial.panel.title'], exact: true }).count()
    ).resolves.toBe(0)
  })

  it('sends a draft to review with a note and publishes it from the panel', async () => {
    const documentId = await seeded('Launch memo')
    const page = await open(MEMO_UID, documentId)
    const panel = panelOf(page)
    await panel.getByRole('button', { name: 'Send to review' }).click()
    const dialog = page.getByRole('dialog', { name: 'Send to review' })
    await dialog.getByText('Every island has its static alternative').waitFor()
    // The panel cannot read the blocks of the form, so the dialog does not claim their fields are filled.
    await expect(dialog.getByText(en['review.check.fields']).count()).resolves.toBe(0)
    await dialog.getByLabel(/Note for the reviewer/).fill('The intro is new')
    await dialog.getByRole('button', { name: 'Send to review' }).click()
    await eventually(async () => (await editorialOf(documentId)).state).toBe('in_review')
    expect(await editorialOf(documentId)).toMatchObject({ note: 'The intro is new' })
    // No reload: the panel shows the new state, the note and the buttons of a page in review.
    await panel.getByText('The intro is new').waitFor()
    await expect(
      stepsOf(page).getByRole('listitem').nth(1).getAttribute('aria-current')
    ).resolves.toBe('step')
    expect(await panel.getByRole('button').allTextContents()).toEqual(['Publish', 'Send back'])

    await panel.getByRole('button', { name: 'Publish', exact: true }).click()
    await eventually(async () => (await editorialOf(documentId)).state).toBe('published')
    expect(await memos().findOne({ documentId, status: 'published' } as never)).not.toBeNull()
    await panel.getByRole('button', { name: 'Unpublish' }).waitFor()
    expect(await panel.getByRole('button').allTextContents()).toEqual([
      'Publish changes',
      'Unpublish',
    ])
    expect(page.url()).toContain(documentId)
  })

  it('disables the buttons while the form has unsaved changes', async () => {
    const documentId = await seeded('Edited memo')
    const page = await open(MEMO_UID, documentId)
    const panel = panelOf(page)
    const send = panel.getByRole('button', { name: 'Send to review' })
    await send.waitFor()
    await expect(send.isEnabled()).resolves.toBe(true)
    await page.locator('input[name="title"]').fill('Edited memo, again')
    await expect(send.isDisabled()).resolves.toBe(true)
    await expect(panel.getByRole('button', { name: 'Schedule' }).isDisabled()).resolves.toBe(true)
    // It says why.
    await panel.getByText(en['editorial.panel.unsaved']).waitFor()
    // After the save the buttons come back.
    await page.getByRole('button', { name: 'Save' }).click()
    await eventually(() => send.isEnabled()).toBe(true)
    await expect(panel.getByText(en['editorial.panel.unsaved']).count()).resolves.toBe(0)
  })

  it('shows a refused transition as a notification', async () => {
    const documentId = await seeded('Refused memo')
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    // The site's policy leaves the super admin out; the panel still offers the button.
    await sites.update({
      documentId: siteDocumentId,
      data: { editorialPolicy: { 'draft->in_review': ['strapi-author'] } } as never,
    })
    try {
      const page = await open(MEMO_UID, documentId)
      const panel = panelOf(page)
      await panel.getByRole('button', { name: 'Send to review' }).click()
      // The dialog's dry run asks the server first, and the refusal shows then.
      await page.getByText(en['review.refusal.editorialTransitionForbidden.title']).waitFor()
      await page.getByText(en['review.refusal.editorialTransitionForbidden']).waitFor()
      expect((await editorialOf(documentId)).state).toBe('draft')
    } finally {
      await sites.update({ documentId: siteDocumentId, data: { editorialPolicy: null } as never })
    }
  })

  it('does not show the panel on the published version', async () => {
    const documentId = await seeded('Live memo')
    const page = await open(MEMO_UID, documentId)
    for (const to of ['in_review', 'published']) {
      await strapi
        .plugin('micelio')
        .service('transitions')
        .perform({
          uid: MEMO_UID,
          documentId,
          to,
          actor: { kind: 'user', id: adminId, roles: ['strapi-super-admin'] },
        })
    }
    await page.reload()
    await panelOf(page).getByRole('button', { name: 'Publish changes' }).waitFor()
    await page.goto(
      `${base}/admin/content-manager/collection-types/${MEMO_UID}/${documentId}?status=published`
    )
    await page.getByRole('heading', { name: 'Entry', exact: true }).waitFor()
    await expect(
      page.getByRole('heading', { name: en['editorial.panel.title'], exact: true }).count()
    ).resolves.toBe(0)
  })

  it('schedules from the panel, shows the time and goes back to draft', async () => {
    const documentId = await seeded('Later memo')
    const page = await open(MEMO_UID, documentId)
    const panel = panelOf(page)
    await panel.getByRole('button', { name: 'Schedule', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Schedule publication' })
    await dialog.getByLabel('Time').fill('09:30')
    await dialog.getByRole('button', { name: 'Schedule', exact: true }).click()
    await eventually(async () => (await editorialOf(documentId)).state).toBe('scheduled')
    // Scheduled stands in the place of Published, and the time is said.
    await panel.getByText(/^Publishes on /).waitFor()
    expect(await stepsOf(page).getByRole('listitem').allTextContents()).toEqual([
      'Draft',
      'In review',
      'Scheduled',
    ])
    await panel.getByRole('button', { name: 'Back to draft' }).click()
    await eventually(async () => (await editorialOf(documentId)).state).toBe('draft')
    await panel.getByRole('button', { name: 'Send to review' }).waitFor()
    await expect(panel.getByText(/^Publishes on /).count()).resolves.toBe(0)
  })

  it('has no WCAG 2.2 A or AA violation in the panel', async () => {
    const documentId = await seeded('Axe memo')
    const page = await open(MEMO_UID, documentId)
    const panel = panelOf(page)
    await panel.getByRole('button', { name: 'Send to review' }).waitFor()
    await settled(page)
    const results = await new AxeBuilder({ page })
      .include('aside:has(h2)')
      .withTags(WCAG_TAGS)
      .analyze()
    expect(results.violations.map(({ id }) => id)).toEqual([])
  })
})
