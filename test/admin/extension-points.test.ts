import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core } from '@strapi/strapi'
import { chromium, type Browser, type Page } from 'playwright'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'

const PASSWORD = 'Password1234'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']
const action = (name: string) => ({ action: name, subject: null, properties: {}, conditions: [] })

// The sub-navigation, the Status card and "Copy diagnostics" for `extension-fixture`, a sibling
// plugin of the test app (test/strapi/app/src/plugins/extension-fixture/).
describe('the extension points in the admin', () => {
  let strapi: Core.Strapi
  let base: string
  let browser: Browser

  async function createUser(email: string, language: string | null, actions: string[] | 'super') {
    const roles = strapi.service('admin::role')
    const role =
      actions === 'super'
        ? await strapi.db.query('admin::role').findOne({ where: { code: 'strapi-super-admin' } })
        : await roles.create({ name: email, description: email })
    if (actions !== 'super') await roles.assignPermissions(role.id, actions.map(action))
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

  async function open(email: string, path = ''): Promise<Page> {
    const context = await browser.newContext()
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
    const page = await context.newPage()
    await page.goto(`${base}/admin/auth/login`)
    await page.locator('input[name="email"]').fill(email)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL(/\/admin(?!\/auth)/)
    await page.goto(`${base}/admin/plugins/micelio${path}`)
    return page
  }

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    base = `http://127.0.0.1:${(strapi.server.httpServer.address() as AddressInfo).port}`
    await createUser('reader@example.com', null, [
      'plugin::micelio.status.read',
      'plugin::extension-fixture.read',
    ])
    await createUser('lector@example.com', 'es', [
      'plugin::micelio.status.read',
      'plugin::extension-fixture.read',
    ])
    await createUser('status@example.com', null, ['plugin::micelio.status.read'])
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await browser?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
  })

  it('shows the plugin item in its group of the sub-navigation, and opens the page it provided', async () => {
    const page = await open('reader@example.com')
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    await nav.getByRole('link', { name: 'Fixture page' }).click()
    await page.getByRole('heading', { name: 'Fixture page content' }).waitFor()
    expect(page.url()).toMatch(/\/plugins\/micelio\/fixture$/)
    await expect(nav.getByText('Site', { exact: true }).count()).resolves.toBe(1)
  })

  it('hides the item from a role without the plugin permission', async () => {
    const page = await open('status@example.com')
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    await nav.getByRole('link', { name: 'Status' }).waitFor()
    await expect(nav.getByRole('link', { name: 'Fixture page' }).count()).resolves.toBe(0)
  })

  it('says so when the path has no page', async () => {
    const page = await open('reader@example.com', '/nothing-here')
    await page.getByRole('heading', { name: 'This page is not available' }).waitFor()
  })

  it('shows the plugin card after Run again, and Copy diagnostics holds its summary line', async () => {
    const page = await open('reader@example.com')
    await page.getByRole('heading', { name: 'Fixture checks' }).waitFor()
    await expect(
      page.getByText('These checks have not run since Strapi started.').count()
    ).resolves.toBe(1)
    await page.getByRole('button', { name: 'Run again' }).click()
    await page.getByRole('row').filter({ hasText: 'The fixture has a handle' }).waitFor()
    const card = page.getByRole('row').filter({ hasText: 'The fixture answers' })
    await expect(card.textContent()).resolves.toContain('default')

    await page.getByRole('button', { name: 'Copy diagnostics' }).click()
    await page
      .getByRole('status')
      .filter({ hasText: 'The diagnostics were copied.' })
      .waitFor({ state: 'attached' })
    const copied = await page.evaluate(() =>
      (
        globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }
      ).navigator.clipboard.readText()
    )
    expect(copied).toContain('fixture-checks: 1 ok, 1 warn, 0 fail')

    const results = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
    expect(
      results.violations.flatMap(({ id, nodes }) =>
        nodes.map((node) => [id, node.target, node.failureSummary])
      )
    ).toEqual([])
  })

  it('shows the item and the card in Spanish', async () => {
    const page = await open('lector@example.com')
    const nav = page.getByRole('navigation', { name: 'Secciones de Micelio' })
    await nav.getByRole('link', { name: 'Página de prueba' }).waitFor()
    await page.getByRole('heading', { name: 'Comprobaciones de prueba' }).waitFor()
    await page.getByRole('button', { name: 'Copiar diagnóstico' }).waitFor()
  })
})
