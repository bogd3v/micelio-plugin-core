import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
import { PREVIEW_PERMISSION } from '../../server/src/constants/preview'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'
import { startPreviewSite, type PreviewSite } from '../strapi/preview-site'

const LANDING = 'api::landing.landing'
const SETTING = 'plugin::micelio.block-setting'
const PASSWORD = 'Password1234'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: 15_000 })

/** The few matchers of Playwright's `expect` the suite needs, on vitest's `expect.poll` (the repository has no `@playwright/test`). */
function that(locator: Locator) {
  return {
    toHaveCount: (count: number) => poll(() => locator.count()).toBe(count),
    toHaveText: (text: string) => poll(() => locator.innerText()).toBe(text),
    toContainText: (text: string) => poll(() => locator.innerText()).toContain(text),
    toBeDisabled: () => poll(() => locator.isDisabled()).toBe(true),
    toBeVisible: () => locator.waitFor(),
    not: {
      toBeChecked: () => poll(() => locator.isChecked()).toBe(false),
      toContainText: (text: string) => poll(() => locator.innerText()).not.toContain(text),
    },
  }
}

// The Block catalogue page in a browser (#51): the switch, the drawer, the merged view the palette
// reads, the role that may only read, "Measure again" and the axe run.
describe('the Block catalogue page in the admin', () => {
  let strapi: Core.Strapi
  let base: string
  let site: PreviewSite
  let browser: Browser
  let adminToken = ''
  const contexts: BrowserContext[] = []

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

  async function open(email: string): Promise<Page> {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      bypassCSP: true,
    })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto(`${base}/admin/auth/login`)
    await page.locator('input[name="email"]').fill(email)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL(/\/admin(?!\/auth)/)
    await page.goto(`${base}/admin/plugins/micelio/blocks`)
    return page
  }

  /** The blocks the palette of the site would offer: the merged view, asked as an admin user would. */
  async function palette(): Promise<string[]> {
    const response = await fetch(`${base}/micelio/blocks?site=default`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    return ((await response.json()) as { data: { id: string }[] }).data.map(({ id }) => id)
  }

  const violationsOf = async (page: Page) =>
    (
      await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
    ).violations.flatMap(({ id, nodes }) =>
      nodes.map(({ target, failureSummary }) => ({ id, target, failureSummary }))
    )

  const switchOf = (page: Page, block: string) =>
    page.getByTestId(`block-row-${block}`).getByRole('switch')

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    strapi.config.set('plugin::micelio.budgets', {
      ...strapi.config.get<Record<string, unknown>>('plugin::micelio.budgets'),
      contentTypes: [LANDING],
    })
    base = `http://127.0.0.1:${(strapi.server.httpServer.address() as AddressInfo).port}`
    site = await startPreviewSite()
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    const defaultSite = (await sites.findFirst()) as { documentId: string }
    await sites.update({ documentId: defaultSite.documentId, data: { url: site.origin } as never })
    const apiToken = (await strapi.service('admin::api-token').create({
      name: 'blocks-page-test',
      type: 'custom',
      lifespan: null,
      permissions: ['plugin::micelio.preview.exchange', 'plugin::micelio.preview.draft'],
    })) as { accessKey: string }
    site.connect({ base, apiToken: apiToken.accessKey, adminOrigin: base })
    await strapi.documents(LANDING as UID.ContentType).create({
      locale: 'en',
      data: {
        title: 'Priced landing',
        site: defaultSite.documentId,
        sections: [
          { __component: 'section.rich-text', body: 'Welcome.' },
          { __component: 'section.scene', variant: 'inline', alt: 'A globe', title: 'Globe' },
        ],
      } as never,
    })

    const roles = strapi.service('admin::role')
    const superAdmin = (await strapi.db
      .query('admin::role')
      .findOne({ where: { code: 'strapi-super-admin' } })) as { id: number }
    await createUser('admin@example.com', superAdmin.id, null)
    await createUser('admin-es@example.com', superAdmin.id, 'es')
    const reader = (await roles.create({ name: 'Blocks reader', code: 'blocks-reader' })) as {
      id: number
    }
    await roles.addPermissions(reader.id, [
      { action: 'plugin::micelio.blocks.read', subject: null, conditions: [], properties: {} },
    ])
    await createUser('reader@example.com', reader.id, null)
    const measurer = (await roles.create({ name: 'Measurer', code: 'measurer' })) as { id: number }
    await roles.addPermissions(measurer.id, [
      { action: 'plugin::micelio.blocks.read', subject: null, conditions: [], properties: {} },
      { action: PREVIEW_PERMISSION, subject: null, conditions: [], properties: {} },
      {
        action: 'plugin::content-manager.explorer.read',
        subject: LANDING,
        conditions: [],
        properties: { fields: ['title', 'sections', 'site'], locales: ['en'] },
      },
    ])
    await createUser('measurer@example.com', measurer.id, null)
    const login = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: PASSWORD }),
    })
    adminToken = ((await login.json()) as { data: { token: string } }).data.token
    browser = await chromium.launch()
  })

  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close()
    await strapi.db.query(SETTING as UID.ContentType).deleteMany({})
    site.weight.requests.length = 0
  })

  afterAll(async () => {
    await browser?.close()
    await site?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
  })

  it('lists the 19 blocks, toggles one and sees it leave the palette and come back', async () => {
    const page = await open('admin@example.com')
    await page.getByRole('heading', { level: 1, name: 'Block catalogue' }).waitFor()
    await that(page.locator('tbody tr')).toHaveCount(19)
    await that(page.getByTestId('block-counts')).toHaveText('0 disabled on default · 19 enabled')
    expect(await palette()).toContain('hero')

    // Flipping a switch with the keyboard keeps the focus on the same element and what an open drawer
    // holds: the table is not replaced while it is read again.
    await page
      .getByTestId('block-row-feature-grid')
      .getByRole('button', { name: 'Feature grid' })
      .click()
    await page.getByTestId('block-drawer').getByLabel('English').fill('Not saved yet')
    await switchOf(page, 'hero').evaluate((element) => element.setAttribute('data-mark', 'same'))
    await switchOf(page, 'hero').focus()
    await page.keyboard.press('Space')
    await that(page.getByTestId('block-counts')).toHaveText('1 disabled on default · 18 enabled')
    expect(await page.evaluate("document.activeElement?.getAttribute('data-mark') ?? null")).toBe(
      'same'
    )
    expect(await page.getByTestId('block-drawer').getByLabel('English').inputValue()).toBe(
      'Not saved yet'
    )
    expect(await palette()).not.toContain('hero')
    expect(await palette()).toContain('faq')
    await that(switchOf(page, 'hero')).not.toBeChecked()

    await page.getByLabel('Disabled only').check()
    await that(page.locator('tbody tr')).toHaveCount(1)
    await page.getByLabel('Disabled only').uncheck()

    await switchOf(page, 'hero').click()
    await that(page.getByTestId('block-counts')).toHaveText('0 disabled on default · 19 enabled')
    expect(await palette()).toContain('hero')
  })

  it('filters by search, family and islands', async () => {
    const page = await open('admin@example.com')
    await that(page.locator('tbody tr')).toHaveCount(19)
    await page.getByLabel('Search').fill('grid')
    await that(page.locator('tbody tr')).toHaveCount(1)
    await page.getByLabel('Search').fill('')
    await page.getByLabel('Islands only').check()
    await that(page.getByTestId('block-row-scene')).toBeVisible()
    await that(page.getByTestId('block-row-hero')).toHaveCount(0)
    await page.getByLabel('Islands only').uncheck()
    await page.getByLabel('Family').selectOption('article')
    await that(page.locator('tbody tr')).toHaveCount(5)
  })

  it('saves the page types, the default options and the label from the drawer, and resets them', async () => {
    const page = await open('admin@example.com')
    await page
      .getByTestId('block-row-feature-grid')
      .getByRole('button', { name: 'Feature grid' })
      .click()
    const drawer = page.getByTestId('block-drawer')
    await drawer.getByRole('heading', { name: 'Feature grid' }).waitFor()
    // The values are the contract's: a feature grid has no 6.
    await that(drawer.getByRole('radio', { name: '6' })).toHaveCount(0)
    await drawer
      .getByRole('group', { name: /columns/ })
      .getByLabel('2')
      .check()
    await drawer.getByLabel('Standard').uncheck()
    await drawer.getByLabel('English').fill('Grid of features')
    await drawer.getByRole('button', { name: 'Save' }).click()
    await that(page.getByTestId('block-row-feature-grid')).toContainText('Grid of features')
    const allowed = page.getByTestId('block-row-feature-grid')
    await that(allowed).toContainText('Landing')
    await that(allowed).toContainText('Long read')
    await that(allowed).not.toContainText('Standard')

    const response = await fetch(`${base}/micelio/blocks?site=default`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    const { data } = (await response.json()) as {
      data: {
        id: string
        options: Record<string, { default: string }>
        pageTypes: string[]
        label: { en?: string }
      }[]
    }
    const stored = data.find(({ id }) => id === 'feature-grid')
    expect(stored?.options.columns?.default).toBe('2')
    expect(stored?.pageTypes.toSorted()).toEqual(['landing', 'long-read'])
    expect(stored?.label.en).toBe('Grid of features')

    await page
      .getByTestId('block-drawer')
      .getByRole('button', { name: 'Reset to core defaults' })
      .click()
    await that(page.getByTestId('block-row-feature-grid')).not.toContainText('Grid of features')
    await that(page.getByTestId('block-row-feature-grid')).toContainText('Standard')
  })

  it('shows a reader the settings and lets it change nothing', async () => {
    const page = await open('reader@example.com')
    await page.getByRole('heading', { level: 1, name: 'Block catalogue' }).waitFor()
    await that(switchOf(page, 'hero')).toBeDisabled()
    await page.getByTestId('block-row-hero').getByRole('button', { name: 'Hero' }).click()
    const drawer = page.getByTestId('block-drawer')
    await that(
      drawer.getByText('Your role may read these settings but not change them.')
    ).toBeVisible()
    await that(drawer.getByRole('button', { name: 'Save' })).toHaveCount(0)
  })

  it('measures a block on a page that holds it only when asked, and compares it with the declared cost', async () => {
    site.weight.baseKb = 10
    site.weight.blockKb = { scene: 1.9, 'rich-text': 1 }
    const page = await open('measurer@example.com')
    await page.getByTestId('block-row-scene').getByRole('button', { name: 'Scene' }).click()
    const drawer = page.getByTestId('block-drawer')
    await drawer.getByRole('link', { name: 'Priced landing' }).waitFor()
    await that(drawer.getByTestId('block-cost')).toContainText('Declared 1.9 kB.')
    // Opening the page and the drawer asked the frontend for nothing, and nothing is measuring.
    await page.waitForLoadState('networkidle')
    await that(drawer.getByRole('status')).toHaveCount(0)
    expect(site.weight.requests).toEqual([])
    expect(site.exchanges).toBe(0)

    await drawer.getByRole('button', { name: 'Measure again' }).click()
    await that(drawer.getByTestId('block-cost')).toHaveText(
      'Declared 1.9 kB · measured now 1.9 kB on Priced landing (within tolerance)'
    )
    expect(site.weight.requests.length).toBeGreaterThan(0)
    expect(site.weight.requests.every((request) => request.via === 'cookie')).toBe(true)
    expect(new Set(site.weight.requests.map((request) => request.path)).size).toBe(1)

    site.weight.blockKb = { scene: 3, 'rich-text': 1 }
    await drawer.getByRole('button', { name: 'Measure again' }).click()
    await that(drawer.getByTestId('block-cost')).toHaveText(
      'Declared 1.9 kB · measured now 3 kB on Priced landing (1.1 kB over)'
    )
  })

  it('says there is no page to measure a block that no page uses', async () => {
    const page = await open('measurer@example.com')
    await page.getByTestId('block-row-hero').getByRole('button', { name: 'Hero' }).click()
    const drawer = page.getByTestId('block-drawer')
    await that(drawer.getByText('No page of this site uses this block')).toHaveCount(2)
    await that(drawer.getByRole('button', { name: 'Measure again' })).toBeDisabled()
    expect(site.weight.requests).toEqual([])
  })

  it('has no accessibility violation, with the drawer open, in English and in Spanish', async () => {
    const page = await open('admin@example.com')
    await page.getByRole('heading', { level: 1, name: 'Block catalogue' }).waitFor()
    await switchOf(page, 'faq').click()
    await that(page.getByTestId('block-counts')).toContainText('1 disabled')
    await expect(violationsOf(page)).resolves.toEqual([])
    await page
      .getByTestId('block-row-feature-grid')
      .getByRole('button', { name: 'Feature grid' })
      .click()
    await page.getByTestId('block-drawer').getByRole('heading', { name: 'Feature grid' }).waitFor()
    await expect(violationsOf(page)).resolves.toEqual([])

    const spanish = await open('admin-es@example.com')
    await spanish.getByRole('heading', { level: 1, name: 'Catálogo de bloques' }).waitFor()
    await that(spanish.getByTestId('block-counts')).toContainText('desactivados en default')
    await spanish
      .getByTestId('block-row-feature-grid')
      .getByRole('button', { name: 'Feature grid' })
      .click()
    await spanish
      .getByTestId('block-drawer')
      .getByText('Tipos de página donde se permite')
      .waitFor()
    await expect(violationsOf(spanish)).resolves.toEqual([])
  })
})
