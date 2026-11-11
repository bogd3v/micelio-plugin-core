import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type Page } from 'playwright'
import packageJson from '../../package.json'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'

const PLUGIN_VERSION = packageJson.version
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

  async function open(
    email: string,
    path = '',
    beforeGoto?: (page: Page) => Promise<void>
  ): Promise<Page> {
    const page = await (await browser.newContext()).newPage()
    await page.goto(`${base}/admin/auth/login`)
    await page.locator('input[name="email"]').fill(email)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL(/\/admin(?!\/auth)/)
    await beforeGoto?.(page)
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
    // And one for the look of the items.
    await createUser('admin-look@example.com', null, 'super')
    // The new tests each log in on their own: the rate limit counts the logins of one account.
    for (const name of ['version', 'held', 'failed', 'fill', 'order']) {
      await createUser(`admin-${name}@example.com`, null, 'super')
    }
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
      'Block catalogue',
      'Page templates',
      'In review',
      'Sites',
      'Export and import',
      'Fixture page',
      'About Micelio',
    ])
    for (const heading of ['Installation', 'Content', 'Site']) {
      await expect(nav.getByText(heading, { exact: true }).count(), heading).resolves.toBe(1)
    }
    expect(page.url()).toMatch(/\/admin\/plugins\/micelio$/)
    await expect(
      nav.getByRole('link', { name: 'Status' }).getAttribute('aria-current')
    ).resolves.toBe('page')
    await expect(nav.locator('[aria-current="page"]').count()).resolves.toBe(1)
  })

  it('shows the plugin core version under the Micelio title', async () => {
    const page = await open('admin-version@example.com')
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    const title = nav.getByRole('heading', { level: 2, name: 'Micelio' })
    const version = nav.getByText(`plugin core ${PLUGIN_VERSION}`, { exact: true })
    await version.waitFor()
    // It is `plugin.version` of `GET /micelio/about`, under the title and in neutral600.
    const [titleBox, versionBox] = await Promise.all([title.boundingBox(), version.boundingBox()])
    expect(versionBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height)
    // The rule under the header is neutral150 (rgb(234, 234, 239)), and ours alone.
    await expect(
      title.evaluate((heading) => {
        const view = heading.ownerDocument.defaultView!
        const header = heading.parentElement!
        return {
          rule: view.getComputedStyle(header).borderBottom,
          colour: view.getComputedStyle(heading.nextElementSibling!).color,
        }
      })
    ).resolves.toEqual({ rule: '1px solid rgb(234, 234, 239)', colour: 'rgb(102, 102, 135)' })
  })

  it('shows the items while the version is not known yet', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const page = await open('admin-held@example.com', '', async (target) => {
      await target.route('**/micelio/about', async (route) => {
        await held
        await route.continue()
      })
    })
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    // The items and the page show while the request is held; the title is alone.
    await nav.getByRole('link', { name: 'Status' }).waitFor()
    await nav.getByRole('link', { name: 'Block catalogue' }).waitFor()
    await nav.getByRole('heading', { level: 2, name: 'Micelio' }).waitFor()
    await expect(nav.getByText(/^plugin core/).count()).resolves.toBe(0)
    release()
    await nav.getByText(`plugin core ${PLUGIN_VERSION}`, { exact: true }).waitFor()
    // A request that fails leaves the title alone too.
    const failing = await open('admin-failed@example.com', '', async (target) => {
      await target.route('**/micelio/about', (route) => route.abort())
    })
    const failingNav = failing.getByRole('navigation', { name: 'Micelio sections' })
    await failingNav.getByRole('link', { name: 'Block catalogue' }).waitFor()
    await expect(failingNav.getByText(/^plugin core/).count()).resolves.toBe(0)
  })

  it("fills the open item to the sub-navigation's width, with the bar on its right border", async () => {
    const page = await open('admin-fill@example.com')
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    await nav.getByRole('link', { name: 'Status' }).waitFor()
    const measure = (name: string) =>
      nav.getByRole('link', { name }).evaluate((link) => {
        const view = link.ownerDocument.defaultView!
        const navigation = link.closest('nav')!
        const inner = link.firstElementChild!
        const box = link.getBoundingClientRect()
        const edge = navigation.getBoundingClientRect()
        const innerBox = inner.getBoundingClientRect()
        const inside = view.getComputedStyle(inner)
        const label = link.querySelector('div > div > div')!.getBoundingClientRect()
        return {
          // The link runs from the sub-navigation's left edge to its right border.
          left: box.left - edge.left,
          right:
            edge.right - parseFloat(view.getComputedStyle(navigation).borderRightWidth) - box.right,
          fills: innerBox.width === box.width,
          radius: inside.borderTopLeftRadius,
          background: inside.backgroundColor,
          labelLeft: label.left - edge.left,
        }
      })
    await expect(measure('Status')).resolves.toMatchObject({
      left: 0,
      right: 0,
      fills: true,
      radius: '0px',
      // primary100
      background: 'rgb(240, 240, 255)',
      // The text keeps the left edge of the headings (20px).
      labelLeft: 20,
    })
    // The About item, under the divider, fills the width too.
    await expect(measure('About Micelio')).resolves.toMatchObject({
      left: 0,
      right: 0,
      fills: true,
    })
    // The divider runs from the text's left edge to the same inset on the right.
    const rule = await nav.getByRole('link', { name: 'About Micelio' }).evaluate((link) => {
      let node = link.parentElement!
      while (node.ownerDocument.defaultView!.getComputedStyle(node).borderTopWidth !== '1px')
        node = node.parentElement!
      const edge = link.closest('nav')!.getBoundingClientRect()
      const box = node.getBoundingClientRect()
      return { left: box.left - edge.left, right: edge.right - 1 - box.right }
    })
    expect(rule).toEqual({ left: 20, right: 20 })
  })

  it('lists Block catalogue, Page templates and In review in the group Content, in that order', async () => {
    const page = await open('admin-order@example.com')
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    await nav.getByRole('link', { name: 'Fixture page' }).waitFor()
    await expect(
      nav
        .getByText('Content', { exact: true })
        .locator('xpath=ancestor::li[1]')
        .getByRole('link')
        .allTextContents()
    ).resolves.toEqual(['Block catalogue', 'Page templates', 'In review'])
  })

  it('shows the groups Installation, Content and Site, and About Micelio under a divider with no heading', async () => {
    const page = await open('admin-look@example.com')
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    await nav.getByRole('link', { name: 'Fixture page' }).waitFor()
    for (const heading of ['Installation', 'Content', 'Site']) {
      await expect(nav.getByText(heading, { exact: true }).count(), heading).resolves.toBe(1)
    }
    // Neither the old names of the groups nor a heading for About.
    for (const heading of ['Overview', 'About']) {
      await expect(nav.getByText(heading, { exact: true }).count(), heading).resolves.toBe(0)
    }
    // The About item sits under a rule that no other item has.
    const about = nav.getByRole('link', { name: 'About Micelio' })
    const ruleAbove = (name: string) =>
      nav.getByRole('link', { name }).evaluate((link) => {
        const view = link.ownerDocument.defaultView!
        for (
          let node = link.parentElement;
          node && node.tagName !== 'NAV';
          node = node.parentElement
        ) {
          if (view.getComputedStyle(node).borderTopWidth === '1px') return true
        }
        return false
      })
    await expect(about.count()).resolves.toBe(1)
    await expect(ruleAbove('About Micelio')).resolves.toBe(true)
    await expect(ruleAbove('Sites')).resolves.toBe(false)
    // The item comes after the last group, whose links are the other seven.
    await expect(nav.getByRole('link').last().textContent()).resolves.toBe('About Micelio')
  })

  it('marks the active item with a bar on its right edge', async () => {
    const page = await open('admin-look@example.com')
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    // The bar is drawn after the link's content: 3px wide, on its right edge, in the primary colour.
    const barOf = (name: string) =>
      nav.getByRole('link', { name }).evaluate((link) => {
        const style = link.ownerDocument.defaultView!.getComputedStyle(link, '::after')
        return style.content === 'none'
          ? null
          : { width: style.width, right: style.right, position: style.position }
      })
    await nav.getByRole('link', { name: 'Status' }).waitFor()
    await expect(barOf('Status')).resolves.toEqual({
      width: '3px',
      right: '0px',
      position: 'absolute',
    })
    await expect(barOf('Sites')).resolves.toBeNull()
    await nav.getByRole('link', { name: 'About Micelio' }).click()
    await page.getByRole('heading', { level: 1, name: 'About Micelio' }).waitFor()
    await expect(barOf('About Micelio')).resolves.toEqual({
      width: '3px',
      right: '0px',
      position: 'absolute',
    })
    await expect(barOf('Status')).resolves.toBeNull()
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
    for (const heading of ['Installation', 'Content', 'Site']) {
      await expect(nav.getByText(heading, { exact: true }).count(), heading).resolves.toBe(0)
    }
  })

  it('reaches every item with Tab and opens it with Enter', async () => {
    const page = await open('admin@example.com')
    const nav = page.getByRole('navigation', { name: 'Micelio sections' })
    await nav.getByRole('link', { name: 'Status' }).waitFor()
    await nav.getByRole('link', { name: 'Status' }).focus()
    for (const [name, path] of [
      ['Block catalogue', /\/plugins\/micelio\/blocks$/],
      ['Page templates', /\/plugins\/micelio\/templates$/],
      ['In review', /\/plugins\/micelio\/review$/],
      ['Sites', /\/plugins\/micelio\/sites$/],
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
    for (const heading of ['Instalación', 'Sitio']) {
      await expect(nav.getByText(heading, { exact: true }).count(), heading).resolves.toBe(1)
    }
    // About has no heading of its own.
    await expect(nav.getByText('Acerca de', { exact: true }).count()).resolves.toBe(0)
    await nav.getByRole('link', { name: 'Acerca de Micelio' }).click()
    await page.getByRole('heading', { level: 1, name: 'Acerca de Micelio' }).waitFor()
  })
})
