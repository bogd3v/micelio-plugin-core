import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type Page } from 'playwright'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'

const EMAIL = 'admin@example.com'
// A second super admin whose interface language is Spanish (see test/admin/status-page.test.ts).
const SPANISH_EMAIL = 'admin-es@example.com'
const PASSWORD = 'Password1234'

/** Opens the About page in a context of its own, logged in as one admin user. */
async function openAbout(browser: Browser, base: string, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto(`${base}/admin/auth/login`)
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(/\/admin(?!\/auth)/)
  await page.goto(`${base}/admin/plugins/micelio/about`)
  return page
}

/** The text of the row whose label is `label`: its `dd`. */
async function rowOf(page: Page, label: string): Promise<string> {
  const term = page.locator('dt', { hasText: label })
  return (await term.locator('xpath=following-sibling::dd[1]').textContent()) ?? ''
}

describe('the theme row of the About page', () => {
  let strapi: Core.Strapi
  let base: string
  let browser: Browser

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    process.env.MICELIO_UPDATE_CHECK = 'false'
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const superAdmin = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    for (const [email, preferedLanguage] of [
      [EMAIL, null],
      [SPANISH_EMAIL, 'es'],
    ]) {
      await strapi.service('admin::user').create({
        email,
        firstname: 'Admin',
        lastname: 'Test',
        password: PASSWORD,
        roles: [superAdmin.id],
        isActive: true,
        preferedLanguage,
      })
    }
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await browser?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
    delete process.env.MICELIO_UPDATE_CHECK
  })

  it('shows the theme of the default site, in English and in Spanish', async () => {
    const page = await openAbout(browser, base, EMAIL)
    await page.getByRole('heading', { name: 'Versions and compatibility' }).waitFor()
    // The default site pins no theme yet.
    await expect(rowOf(page, 'Theme')).resolves.toBe('Not pinned')

    const sites = strapi.documents(SITE_UID as UID.ContentType)
    const [defaultSite] = await sites.findMany({ filters: { isDefault: true } })
    await sites.update({
      documentId: defaultSite.documentId,
      data: { theme: { themeId: 'bogota', themeVersion: '1.0.0' } } as never,
    })
    await page.reload()
    await page.getByRole('heading', { name: 'Versions and compatibility' }).waitFor()
    await expect(rowOf(page, 'Theme')).resolves.toBe('bogota 1.0.0')

    const spanish = await openAbout(browser, base, SPANISH_EMAIL)
    await spanish.getByRole('heading', { name: 'Versiones y compatibilidad' }).waitFor()
    await expect(rowOf(spanish, 'Tema')).resolves.toBe('bogota 1.0.0')

    // A pin without a version.
    await sites.update({
      documentId: defaultSite.documentId,
      data: { theme: { themeId: 'bogota', themeVersion: null } } as never,
    })
    await spanish.reload()
    await spanish.getByRole('heading', { name: 'Versiones y compatibilidad' }).waitFor()
    await expect(rowOf(spanish, 'Tema')).resolves.toBe('bogota (sin versión fijada)')
  })
})
