import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import en from '../../admin/src/translations/en.json'
import es from '../../admin/src/translations/es.json'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'

// Fixture types (test/strapi/app/src/api/): `page` is site-scoped with a dynamic zone of sections,
// `note` is site-scoped without one, the case of a type whose entries have no blocks to preview, and
// `sketch` has a dynamic zone and no site.
const PAGE_UID = 'api::page.page'
const NOTE_UID = 'api::note.note'
const SKETCH_UID = 'api::sketch.sketch'
const PASSWORD = 'Password1234'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

describe('the preview action in the edit view', () => {
  let strapi: Core.Strapi
  let base: string
  let browser: Browser
  let pageId: string
  let noteId: string
  let sketchId: string
  let superAdminId = 0
  let admins = 0
  const contexts: BrowserContext[] = []

  const editPath = (uid: string, documentId: string) =>
    `${base}/admin/content-manager/collection-types/${uid}/${documentId}?plugins[i18n][locale]=en`

  async function createUser(email: string, roleId: number, preferedLanguage: string | null) {
    await strapi.service('admin::user').create({
      email,
      firstname: 'Admin',
      lastname: 'Test',
      password: PASSWORD,
      roles: [roleId],
      isActive: true,
      preferedLanguage,
    })
  }

  /** A logged-in page of a context of its own, for an admin user of the role. */
  async function open(roleId: number, preferedLanguage: string | null = null): Promise<Page> {
    admins += 1
    const email = `admin-${admins}@example.com`
    await createUser(email, roleId, preferedLanguage)
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto(`${base}/admin/auth/login`)
    await page.locator('input[name="email"]').fill(email)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL(/\/admin(?!\/auth)/)
    return page
  }

  /** The action as the header shows it: the label is its accessible name. */
  const actionOf = (page: Page, label: string) => page.getByRole('button', { name: label })

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const site = (await strapi.documents(SITE_UID as UID.ContentType).findFirst()) as {
      documentId: string
    }
    const page = await strapi.documents(PAGE_UID as UID.ContentType).create({
      data: {
        title: 'Landing',
        slug: 'landing',
        site: site.documentId,
        sections: [{ __component: 'section.rich-text', body: 'Welcome.' }],
      } as never,
    })
    const note = await strapi.documents(NOTE_UID as UID.ContentType).create({
      data: { title: 'A note', site: site.documentId } as never,
    })
    const sketch = await strapi.documents(SKETCH_UID as UID.ContentType).create({
      data: { title: 'A sketch' } as never,
    })
    sketchId = sketch.documentId
    pageId = page.documentId
    noteId = note.documentId
    const superAdmin = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    superAdminId = superAdmin.id
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

  it('shows the action on a page and opens the preview of that document', async () => {
    const page = await open(superAdminId)
    await page.goto(editPath(PAGE_UID, pageId))
    const action = actionOf(page, en['action.preview'])
    await expect(action.isEnabled()).resolves.toBe(true)
    await action.click()
    await page.waitForURL(
      `**/admin/plugins/micelio/preview/${encodeURIComponent(PAGE_UID)}/${pageId}?locale=en`
    )
    await expect(page.getByRole('region', { name: en['preview.pane'] }).isVisible()).resolves.toBe(
      true
    )
  })

  it('does not show it on a type without a dynamic zone', async () => {
    const page = await open(superAdminId)
    await page.goto(editPath(NOTE_UID, noteId))
    await page.getByRole('heading', { name: 'A note' }).waitFor()
    await expect(actionOf(page, en['action.preview']).count()).resolves.toBe(0)
    await expect(actionOf(page, en['action.preview.unsaved']).count()).resolves.toBe(0)
  })

  it('does not show it on a type with a dynamic zone and no site', async () => {
    const page = await open(superAdminId)
    await page.goto(editPath(SKETCH_UID, sketchId))
    await page.getByRole('heading', { name: 'A sketch' }).waitFor()
    await expect(actionOf(page, en['action.preview']).count()).resolves.toBe(0)
    await expect(actionOf(page, en['action.preview.unsaved']).count()).resolves.toBe(0)
  })

  it("opens the plugin's page in the frame of Strapi's own Open preview, beside its form", async () => {
    const page = await open(superAdminId)
    await page.goto(editPath(PAGE_UID, pageId))
    await page.getByRole('link', { name: 'Open preview' }).click()
    await page.waitForURL(
      `**/admin/content-manager/collection-types/${PAGE_UID}/${pageId}/preview*`
    )
    // Strapi frames the URL of the handler beside its own form: here that is the admin again, with
    // the plugin's page (and its own entry column) in the frame.
    const frame = page.frameLocator('iframe')
    await frame.getByRole('region', { name: en['preview.pane'] }).waitFor()
    await frame.getByRole('region', { name: en['preview.entry.title'] }).waitFor()
  })

  it("shows no Open preview button of Strapi's on a type with a dynamic zone and no site", async () => {
    const page = await open(superAdminId)
    // Strapi asks the handler for the URL when the edit view opens; the button waits for the answer.
    const answered = page.waitForResponse((response) =>
      response.url().includes(`/content-manager/preview/url/${SKETCH_UID}`)
    )
    await page.goto(editPath(SKETCH_UID, sketchId))
    expect((await answered).status()).toBe(204)
    await page.getByRole('heading', { name: 'A sketch' }).waitFor()
    await expect(page.getByRole('link', { name: 'Open preview' }).count()).resolves.toBe(0)
  })

  it('does not show it while the entry is being created', async () => {
    const page = await open(superAdminId)
    await page.goto(
      `${base}/admin/content-manager/collection-types/${PAGE_UID}/create?plugins[i18n][locale]=en`
    )
    await page.getByRole('heading', { name: 'Create an entry' }).waitFor()
    await expect(actionOf(page, en['action.preview']).count()).resolves.toBe(0)
  })

  it('does not show it to a role without the permission to preview', async () => {
    const role = (await strapi
      .service('admin::role')
      .create({ name: 'Writer', code: 'writer' })) as {
      id: number
    }
    await strapi.service('admin::role').addPermissions(role.id, [
      {
        action: 'plugin::content-manager.explorer.read',
        subject: PAGE_UID,
        conditions: [],
        properties: { fields: ['title', 'slug', 'sections', 'site'], locales: ['en'] },
      },
    ])
    const page = await open(role.id)
    await page.goto(editPath(PAGE_UID, pageId))
    await page.getByRole('heading', { name: 'Landing' }).waitFor()
    await expect(actionOf(page, en['action.preview']).count()).resolves.toBe(0)
  })

  it('is disabled with unsaved changes, says why, and comes back once the entry is saved', async () => {
    const page = await open(superAdminId)
    await page.goto(editPath(PAGE_UID, pageId))
    await expect(actionOf(page, en['action.preview']).isEnabled()).resolves.toBe(true)

    await page.getByRole('textbox', { name: 'title' }).fill('Landing, edited')
    const disabled = actionOf(page, en['action.preview.unsaved'])
    await disabled.waitFor()
    await expect(disabled.isDisabled()).resolves.toBe(true)
    // The explanation is the button's tooltip as well as its accessible name.
    await disabled.hover({ force: true })
    await expect
      .poll(() =>
        page.locator('[role="tooltip"]', { hasText: en['action.preview.unsaved'] }).count()
      )
      .toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Save', exact: true }).click()
    // The header updates a moment after the save settles.
    await expect
      .poll(() => actionOf(page, en['action.preview']).isEnabled(), { timeout: 15_000 })
      .toBe(true)
  })

  it('has no accessibility violations and speaks Spanish to a Spanish admin user', async () => {
    const page = await open(superAdminId, 'es')
    await page.goto(editPath(PAGE_UID, pageId))
    const action = actionOf(page, es['action.preview'])
    await action.waitFor()
    // Strapi's own header has findings of its own: the run covers the action only.
    await action.evaluate((element) => element.setAttribute('data-axe-target', ''))
    const results = await new AxeBuilder({ page })
      .include('[data-axe-target]')
      .withTags(WCAG_TAGS)
      .analyze()
    expect(results.violations.map(({ id }) => id)).toEqual([])
  })
})
