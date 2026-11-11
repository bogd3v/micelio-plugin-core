import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core } from '@strapi/strapi'
import { chromium, type Browser, type Page } from 'playwright'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'

const PASSWORD = 'Password1234'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']
const grant = (action: string, subject: string | null = null) => ({
  action,
  subject,
  properties: {},
  conditions: [],
})
const READ_SITES = grant('plugin::content-manager.explorer.read', SITE_UID)
const UPDATE_SITES = grant('plugin::content-manager.explorer.update', SITE_UID)
const FIXTURE_READ = grant('plugin::extension-fixture.read')

// The Sites page and the panels of the site sections of `extension-fixture`, a sibling plugin of
// the test app (test/strapi/app/src/plugins/extension-fixture/): `fixture-profile` has a panel,
// `fixture-unpanelled` has none.
describe('the Sites page in the admin', () => {
  let strapi: Core.Strapi
  let base: string
  let browser: Browser

  async function createUser(email: string, language: string | null, grants: object[]) {
    const roles = strapi.service('admin::role')
    const role = await roles.create({ name: email, description: email })
    await roles.assignPermissions(role.id, grants)
    await strapi.service('admin::user').create({
      email,
      firstname: 'Admin',
      lastname: 'Test',
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
      preferedLanguage: language,
    })
  }

  async function open(email: string): Promise<Page> {
    const page = await (await browser.newContext()).newPage()
    await page.goto(`${base}/admin/auth/login`)
    await page.locator('input[name="email"]').fill(email)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL(/\/admin(?!\/auth)/)
    await page.goto(`${base}/admin/plugins/micelio/sites`)
    return page
  }

  const panelLoads = (page: Page) =>
    page.evaluate(
      () =>
        (globalThis as unknown as { fixtureProfilePanelLoads?: number }).fixtureProfilePanelLoads ??
        0
    )

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    base = `http://127.0.0.1:${(strapi.server.httpServer.address() as AddressInfo).port}`
    await createUser('reader@example.com', null, [READ_SITES, FIXTURE_READ])
    await createUser('writer@example.com', null, [READ_SITES, UPDATE_SITES, FIXTURE_READ])
    // Reads the sites but has no permission of the fixture's sections.
    await createUser('plain@example.com', null, [READ_SITES])
    await createUser('lector@example.com', 'es', [READ_SITES, FIXTURE_READ])
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await browser?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
  })

  it("shows the fixture plugin's panel under the core fields to a role with its permission", async () => {
    const page = await open('reader@example.com')
    const core = page.getByRole('heading', { name: 'Core fields' })
    const panel = page.getByText('Profile panel of default: handle unset, read only')
    await panel.waitFor()
    await expect(page.getByRole('heading', { name: 'Fixture profile' }).count()).resolves.toBe(1)
    const [coreBox, panelBox] = await Promise.all([core.boundingBox(), panel.boundingBox()])
    expect(panelBox!.y).toBeGreaterThan(coreBox!.y)
    // The core fields link to the site's entry in the Content Manager.
    const entry = page.getByRole('link', { name: 'default', exact: true })
    await expect(entry.getAttribute('href')).resolves.toMatch(
      /\/content-manager\/collection-types\/plugin::micelio\.site\/\w+$/
    )

    // `canWrite` is true for a role that may update the Site type.
    const writer = await open('writer@example.com')
    await writer.getByText('Profile panel of default: handle unset, editable').waitFor()
  })

  it("shows a role without the section's permission no panel, and loads no panel module for it", async () => {
    const page = await open('plain@example.com')
    await page.getByRole('heading', { name: 'Core fields' }).waitFor()
    await expect(page.getByRole('heading', { name: 'Fixture profile' }).count()).resolves.toBe(0)
    await expect(
      page.getByRole('heading', { name: 'Fixture without a panel' }).count()
    ).resolves.toBe(0)
    await expect(page.getByText('Profile panel of').count()).resolves.toBe(0)
    await expect(panelLoads(page)).resolves.toBe(0)

    // The same module loads once for a role that has the permission.
    const reader = await open('reader@example.com')
    await reader.getByText('Profile panel of default').waitFor()
    await expect(panelLoads(reader)).resolves.toBe(1)
  })

  it('shows a notice that links to the Content Manager entry for a panel with no registered component', async () => {
    const page = await open('reader@example.com')
    await page.getByRole('heading', { name: 'Fixture without a panel' }).waitFor()
    await expect(
      page.getByText('The plugin that registered this section has not provided its panel').count()
    ).resolves.toBe(1)
    const link = page.getByRole('link', { name: 'Edit the section in the Content Manager' })
    await expect(link.getAttribute('href')).resolves.toMatch(
      /\/content-manager\/collection-types\/plugin::micelio\.site\/\w+$/
    )
  })

  it('has no accessibility violation, in English and in Spanish', async () => {
    for (const [email, ready] of [
      ['reader@example.com', 'Profile panel of default'],
      ['lector@example.com', 'Profile panel of default'],
    ] as const) {
      const page = await open(email)
      await page.getByText(ready).waitFor()
      if (email === 'lector@example.com') {
        await page.getByRole('heading', { name: 'Campos básicos' }).waitFor()
        await page.getByRole('heading', { name: 'Prueba sin panel' }).waitFor()
      }
      const results = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
      expect(
        results.violations.flatMap(({ id, nodes }) =>
          nodes.map((node) => [id, node.target, node.failureSummary])
        ),
        email
      ).toEqual([])
    }
  })
})
