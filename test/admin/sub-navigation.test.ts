import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core } from '@strapi/strapi'
import { chromium, type Browser, type Page } from 'playwright'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'

const PASSWORD = 'Password1234'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']
const action = (name: string) => ({ action: name, subject: null, properties: {}, conditions: [] })

// The shell of the Micelio section: its entry in the admin's menu and the sub-navigation, with
// `extension-fixture`, a sibling plugin of the test app (test/strapi/app/src/plugins/).
describe('the sub-navigation in the admin', () => {
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
    const page = await (await browser.newContext()).newPage()
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
    await createUser('admin@example.com', null, 'super')
    await createUser('admin-es@example.com', 'es', 'super')
    // Only a sibling plugin's permission: not the status page's.
    await createUser('sibling@example.com', null, ['plugin::extension-fixture.read'])
    // No permission of any plugin.
    await createUser('plain@example.com', null, [])
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await browser?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
  })

  it('lists the groups with their items, and marks the open page as current', async () => {
    const page = await open('admin@example.com')
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    // The sibling plugin's item arrives with its own request, after the core's.
    await nav.getByRole('link', { name: 'Fixture page' }).waitFor()
    await expect(nav.getByRole('link').allTextContents()).resolves.toEqual([
      'Status',
      'Fixture page',
      'About Micelio',
    ])
    for (const heading of ['Overview', 'Site', 'About']) {
      await expect(nav.getByText(heading, { exact: true }).count(), heading).resolves.toBe(1)
    }
    // A group with no item is not listed.
    await expect(nav.getByText('Content', { exact: true }).count()).resolves.toBe(0)
    expect(page.url()).toMatch(/\/admin\/plugins\/micelio$/)
    await expect(
      nav.getByRole('link', { name: 'Status' }).getAttribute('aria-current')
    ).resolves.toBe('page')
    await expect(nav.locator('[aria-current="page"]').count()).resolves.toBe(1)
  })

  it('has the entry with the Micelio mark in the admin menu', async () => {
    const page = await open('admin@example.com')
    const entry = page.getByRole('link', { name: 'Micelio', exact: true })
    await entry.waitFor()
    // The mark: six nodes, and branches that the menu's `svg path` rule does not fill.
    await expect(entry.locator('svg circle').count()).resolves.toBe(6)
    // Polled: the menu re-renders the entry once the permissions have loaded.
    await expect
      .poll(() =>
        entry
          .locator('svg path')
          .evaluate((path) => path.ownerDocument.defaultView!.getComputedStyle(path).fill)
      )
      .toBe('none')
  })

  it('shows a role without the status permission the entry and About, not Status', async () => {
    const page = await open('sibling@example.com')
    await page.getByRole('link', { name: 'Micelio', exact: true }).waitFor()
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    await nav.getByRole('link', { name: 'About Micelio' }).waitFor()
    await expect(nav.getByRole('link', { name: 'Status' }).count()).resolves.toBe(0)
    // The status page is the index: such a role lands on About, and the sibling item shows.
    await page.waitForURL(/\/plugins\/micelio\/about$/)
    await page.getByRole('heading', { level: 1, name: 'About Micelio' }).waitFor()
    await expect(nav.getByRole('link', { name: 'Fixture page' }).count()).resolves.toBe(1)
  })

  it('shows a role with no permission of any plugin the entry and About only', async () => {
    const page = await open('plain@example.com')
    await page.getByRole('link', { name: 'Micelio', exact: true }).waitFor()
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    await nav.getByRole('link', { name: 'About Micelio' }).waitFor()
    await expect(nav.getByRole('link').allTextContents()).resolves.toEqual(['About Micelio'])
  })

  it('reaches every item with Tab and opens it with Enter', async () => {
    const page = await open('admin@example.com')
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    await nav.getByRole('link', { name: 'Status' }).waitFor()
    await nav.getByRole('link', { name: 'Status' }).focus()
    for (const [name, path] of [
      ['Fixture page', /\/plugins\/micelio\/fixture$/],
      ['About Micelio', /\/plugins\/micelio\/about$/],
    ] as const) {
      await page.keyboard.press('Tab')
      const link = nav.getByRole('link', { name })
      await expect(
        link.evaluate((element) => element === element.ownerDocument.activeElement),
        name
      ).resolves.toBe(true)
      // The focus is visible: the design system outlines the focused item.
      await expect(
        link.evaluate(
          (element) => element.ownerDocument.defaultView!.getComputedStyle(element).outlineStyle
        ),
        name
      ).resolves.not.toBe('none')
      await page.keyboard.press('Enter')
      await page.waitForURL(path)
      await expect(link.getAttribute('aria-current'), name).resolves.toBe('page')
    }
    await page.getByRole('heading', { level: 1, name: 'About Micelio' }).waitFor()
  })

  it('has no WCAG 2.2 A or AA violation in the sub-navigation or the page', async () => {
    const page = await open('admin@example.com')
    await page
      .getByRole('navigation', { name: 'Micelio sections' })
      .getByRole('link', {
        name: 'Status',
      })
      .waitFor()
    await page.getByRole('link', { name: 'About Micelio' }).click()
    await page.getByRole('heading', { level: 1, name: 'About Micelio' }).waitFor()
    const results = await new AxeBuilder({ page })
      .include('nav[aria-label="Micelio sections"]')
      .include('main')
      .withTags(WCAG_TAGS)
      .analyze()
    expect(
      results.violations.flatMap(({ id, nodes }) =>
        nodes.map((node) => [id, node.target, node.failureSummary])
      )
    ).toEqual([])
  })

  it('shows the groups and About in Spanish', async () => {
    const page = await open('admin-es@example.com')
    const nav = page.getByRole('navigation', { name: 'Secciones de Micelio' })
    await nav.getByRole('link', { name: 'Estado' }).waitFor()
    // The Site group holds only the sibling plugin's item, which arrives with its own request after
    // the core's: the group exists once that item does.
    await nav.getByRole('link', { name: 'Página de prueba' }).waitFor()
    for (const heading of ['Resumen', 'Sitio', 'Acerca de']) {
      await expect(nav.getByText(heading, { exact: true }).count(), heading).resolves.toBe(1)
    }
    await nav.getByRole('link', { name: 'Acerca de Micelio' }).click()
    await page.getByRole('heading', { level: 1, name: 'Acerca de Micelio' }).waitFor()
  })
})
