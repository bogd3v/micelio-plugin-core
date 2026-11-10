import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type Page } from 'playwright'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'

const PASSWORD = 'Password1234'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']
const BROCHURE = 'api::brochure.brochure'
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

  // A page of the editorial type of the test app, sent to review by a super admin.
  async function inReview(title: string): Promise<string> {
    const site = (await strapi.documents(SITE_UID as UID.ContentType).findFirst()) as {
      documentId: string
    }
    const created = await strapi.documents(BROCHURE as UID.ContentType).create({
      locale: 'en',
      data: {
        title,
        slug: title.toLowerCase().replace(/\W+/g, '-'),
        site: site.documentId,
      } as never,
    })
    await strapi
      .plugin('micelio')
      .service('transitions')
      .perform({
        uid: BROCHURE,
        documentId: created.documentId,
        locale: 'en',
        to: 'in_review',
        note: 'Please look',
        actor: { kind: 'user', id: 1, roles: ['strapi-super-admin'] },
      })
    return created.documentId
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
    // Its own login: the admin rate-limits the logins of one account.
    await createUser('admin-review@example.com', null, 'super')
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
      'In review',
      'Block catalogue',
      'Page templates',
      'Export and import',
      'Fixture page',
      'About Micelio',
    ])
    for (const heading of ['Overview', 'Content', 'Site', 'About']) {
      await expect(nav.getByText(heading, { exact: true }).count(), heading).resolves.toBe(1)
    }
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
    // A group with no item is not listed.
    for (const heading of ['Overview', 'Content', 'Site']) {
      await expect(nav.getByText(heading, { exact: true }).count(), heading).resolves.toBe(0)
    }
  })

  it('reaches every item with Tab and opens it with Enter', async () => {
    const page = await open('admin@example.com')
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    await nav.getByRole('link', { name: 'Status' }).waitFor()
    await nav.getByRole('link', { name: 'Status' }).focus()
    for (const [name, path] of [
      ['In review', /\/plugins\/micelio\/review$/],
      ['Block catalogue', /\/plugins\/micelio\/blocks$/],
      ['Page templates', /\/plugins\/micelio\/templates$/],
      ['Export and import', /\/plugins\/micelio\/_export-import$/],
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

  it('shows the number of pages in review next to In review', async () => {
    await inReview('Count one')
    await inReview('Count two')
    const page = await open('admin-review@example.com')
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    const link = nav.getByRole('link', { name: 'In review, 2 pages' })
    await link.waitFor()
    await expect(link.textContent()).resolves.toBe('In review\u00a02')
    // The other items show no number.
    await expect(
      nav.getByRole('link', { name: 'Status', exact: true }).textContent()
    ).resolves.toBe('Status')
  })

  it('lowers the number after a page is approved, without a reload', async () => {
    const approve = await inReview('Approve from the list')
    const page = await open('admin-review@example.com', '/review')
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    await nav.getByRole('link', { name: /^In review, \d+ pages?$/ }).waitFor()
    const before = Number(
      (await nav.getByRole('link', { name: /^In review/ }).getAttribute('aria-label'))!.match(
        /\d+/
      )![0]
    )
    expect(before).toBeGreaterThanOrEqual(1)
    // A mark that a reload would wipe.
    await page.evaluate('window.__noReload = true')
    await page.getByRole('row', { name: /Approve from the list/ }).waitFor()
    await page.getByRole('button', { name: 'Approve and publish Approve from the list' }).click()
    await expect
      .poll(
        async () =>
          (await strapi.documents(BROCHURE as UID.ContentType).findOne({
            documentId: approve,
            locale: 'en',
            status: 'draft',
            populate: ['editorial'],
          } as never)) as unknown as { editorial: { state: string } },
        { timeout: 20_000 }
      )
      .toMatchObject({ editorial: { state: 'published' } })
    // The page reloads its own list after the approval; once the row is gone, count from here.
    await page.getByRole('row', { name: /Approve from the list/ }).waitFor({ state: 'detached' })
    // The editor moves to another page of the section: one request, a lower number.
    const requests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/micelio/review')) requests.push(request.url())
    })
    await nav.getByRole('link', { name: 'About Micelio' }).click()
    await page.getByRole('heading', { level: 1, name: 'About Micelio' }).waitFor()
    await expect
      .poll(
        async () =>
          (await nav.getByRole('link', { name: /^In review/ }).getAttribute('aria-label')) ?? '',
        {
          timeout: 20_000,
        }
      )
      .toBe(
        before - 1 === 0
          ? 'In review'
          : `In review, ${before - 1} ${before - 1 === 1 ? 'page' : 'pages'}`
      )
    expect(requests).toHaveLength(1)
    await expect(page.evaluate('window.__noReload')).resolves.toBe(true)
  })

  it('shows no number to a role without the review permission', async () => {
    await inReview('Hidden count')
    const page = await open('sibling@example.com')
    const requests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/micelio/review')) requests.push(request.url())
    })
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    await nav.getByRole('link', { name: 'About Micelio' }).waitFor()
    await nav.getByRole('link', { name: 'Fixture page' }).waitFor()
    await expect(nav.getByRole('link', { name: /In review/ }).count()).resolves.toBe(0)
    expect(requests).toEqual([])
    await expect(nav.getByRole('link').allTextContents()).resolves.not.toContainEqual(
      expect.stringMatching(/\d/)
    )
  })

  it('has no WCAG 2.2 A or AA violation in the sub-navigation or the page', async () => {
    await inReview('Seen by axe')
    const page = await open('admin@example.com')
    // The number is shown while axe reads the navigation.
    await page.getByRole('link', { name: /^In review, \d+ pages?$/ }).waitFor()
    await page
      .getByRole('navigation', { name: 'Micelio sections' })
      .getByRole('link', {
        name: 'Status',
      })
      .waitFor()
    await page.getByRole('link', { name: 'About Micelio' }).click()
    await page.getByRole('heading', { level: 1, name: 'About Micelio' }).waitFor()
    await page.getByRole('link', { name: /^In review, \d+ pages?$/ }).waitFor()
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
    // The sibling plugin's item arrives with its own request after the core's.
    await nav.getByRole('link', { name: 'Página de prueba' }).waitFor()
    await expect(nav.getByRole('link', { name: 'Exportar e importar' }).count()).resolves.toBe(1)
    for (const heading of ['Resumen', 'Sitio', 'Acerca de']) {
      await expect(nav.getByText(heading, { exact: true }).count(), heading).resolves.toBe(1)
    }
    await nav.getByRole('link', { name: 'Acerca de Micelio' }).click()
    await page.getByRole('heading', { level: 1, name: 'Acerca de Micelio' }).waitFor()
  })
})
