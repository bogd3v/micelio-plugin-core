import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import schema from '../../server/src/content-types/site/schema.json'
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
// The Content Manager answers a role only the fields and locales its grant lists: every scalar field
// of the type, in English.
const FIELDS = Object.entries(schema.attributes)
  .filter(([, attribute]) => attribute.type !== 'component' && attribute.type !== 'media')
  .map(([name]) => name)
const onSites = (action: string) => ({
  ...grant(action, SITE_UID),
  properties: { fields: FIELDS, locales: ['en'] },
})
const READ_SITES = onSites('plugin::content-manager.explorer.read')
const UPDATE_SITES = onSites('plugin::content-manager.explorer.update')
const CREATE_SITES = grant('plugin::content-manager.explorer.create', SITE_UID)
const TRANSFER = grant('plugin::micelio.transfer')
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

  // One login per user: the admin rate-limits the logins of one account.
  const contexts = new Map<string, BrowserContext>()

  async function open(email: string): Promise<Page> {
    let context = contexts.get(email)
    if (!context) {
      context = await browser.newContext()
      const login = await context.newPage()
      await login.goto(`${base}/admin/auth/login`)
      await login.locator('input[name="email"]').fill(email)
      await login.locator('input[name="password"]').fill(PASSWORD)
      await login.getByRole('button', { name: 'Login' }).click()
      await login.waitForURL(/\/admin(?!\/auth)/)
      await login.close()
      contexts.set(email, context)
    }
    const page = await context.newPage()
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
    // May create sites and export them.
    await createUser('maker@example.com', null, [READ_SITES, CREATE_SITES, TRANSFER])
    // Two more sites next to the default one: one with hosts, a theme and fields the page does not edit,
    // one with none of them.
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    const defaultSite = await sites.findFirst({ filters: { isDefault: true } })
    await sites.update({
      documentId: defaultSite!.documentId,
      data: {
        hosts: ['demo.example.test', 'www.demo.example.test'],
        theme: { themeId: 'bogota', themeVersion: '1.0.0' },
      } as never,
    })
    await sites.create({
      data: {
        name: 'Landing',
        slug: 'landing',
        hosts: ['landing.example.test'],
        theme: { themeId: 'starter', themeVersion: '1.2.0' },
        description: 'Kept as it was',
        tagline: 'A tagline kept too',
        timezone: 'America/Bogota',
        modules: {},
      } as never,
    })
    await sites.create({ data: { name: 'Plain', slug: 'plain', modules: {} } as never })
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await browser?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
  })

  it("shows the fixture plugin's panel under the core fields to a role with its permission", async () => {
    const page = await open('reader@example.com')
    const core = page
      .getByRole('main')
      .getByRole('heading', { level: 2, name: 'Micelio', exact: true })
    const panel = page.getByText('Profile panel of default: handle unset, read only')
    await panel.waitFor()
    await expect(page.getByRole('heading', { name: 'Fixture profile' }).count()).resolves.toBe(1)
    const [coreBox, panelBox] = await Promise.all([core.boundingBox(), panel.boundingBox()])
    expect(panelBox!.y).toBeGreaterThan(coreBox!.y)
    // The core fields link to the site's entry in the Content Manager.
    const entry = page.getByRole('link', { name: 'Open the entry in the Content Manager' })
    await expect(entry.getAttribute('href')).resolves.toMatch(
      /\/content-manager\/collection-types\/plugin::micelio\.site\/\w+$/
    )

    // `canWrite` is true for a role that may update the Site type.
    const writer = await open('writer@example.com')
    await writer.getByText('Profile panel of default: handle unset, editable').waitFor()
  })

  it("shows a role without the section's permission no panel, and loads no panel module for it", async () => {
    const page = await open('plain@example.com')
    await page
      .getByRole('main')
      .getByRole('heading', { level: 2, name: 'Micelio', exact: true })
      .waitFor()
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

  const table = (page: Page) => page.getByRole('table', { name: 'Sites' })
  const card = (page: Page, name: string) =>
    page.getByRole('main').getByRole('region', { name, exact: true })
  const rows = (page: Page) => table(page).getByRole('row')

  it('lists every site in a table with the default badge, slug, hosts and theme, the default first', async () => {
    const page = await open('reader@example.com')
    await table(page).waitFor()
    await expect(page.getByText('3 sites served by this CMS.').count()).resolves.toBe(1)
    await expect(table(page).getByRole('columnheader').allTextContents()).resolves.toEqual([
      'Name',
      'Slug',
      'Hosts',
      'Theme',
      'Actions',
    ])
    // The header row and a row per site: the default first, then by slug.
    await expect(rows(page).count()).resolves.toBe(4)
    const cells = async (row: number) => rows(page).nth(row).getByRole('cell').allInnerTexts()
    const [name, slug, hosts, theme] = await cells(1)
    expect(name).toMatch(/^Micelio\s+Default$/i)
    expect(slug).toBe('default')
    expect(hosts!.split('\n')).toEqual(['demo.example.test', 'www.demo.example.test'])
    expect(theme!.split('\n')).toEqual(['bogota', '1.0.0'])
    // One host per line, and the slug in monospace.
    await expect(rows(page).nth(1).getByRole('cell').nth(2).locator('div').count()).resolves.toBe(2)
    await expect(
      rows(page)
        .nth(1)
        .getByText('default', { exact: true })
        .evaluate((node) => node.ownerDocument.defaultView!.getComputedStyle(node).fontFamily)
    ).resolves.toMatch(/monospace/)
    const landing = await cells(2)
    expect(landing.slice(0, 4)).toEqual([
      'Landing',
      'landing',
      'landing.example.test',
      'starter\n1.2.0',
    ])
    // A site with no host and no theme says None, and has no badge.
    const plain = await cells(3)
    expect(plain.slice(0, 4)).toEqual(['Plain', 'plain', 'None', 'None'])
    await expect(page.getByText('Default', { exact: true }).count()).resolves.toBe(1)
    // The default site's card is the one shown when the page opens.
    await card(page, 'Micelio').waitFor()
  })

  it('filters the table by name, slug or host as the search is typed', async () => {
    const page = await open('reader@example.com')
    await table(page).waitFor()
    const search = page.getByRole('searchbox', { name: 'Search sites' })
    const shown = async () =>
      (await rows(page).getByRole('cell').allInnerTexts()).filter((_, index) => index % 5 === 1)
    await expect(shown()).resolves.toEqual(['default', 'landing', 'plain'])
    await search.pressSequentially('LAND')
    await expect.poll(shown).toEqual(['landing'])
    await search.fill('www.demo')
    await expect.poll(shown).toEqual(['default'])
    await search.fill('micel')
    await expect.poll(shown).toEqual(['default'])
    await search.fill('pla')
    await expect.poll(shown).toEqual(['plain'])
    await search.fill('nothing like it')
    await expect.poll(shown).toEqual([])
    await page.getByText('No site matches the search.').waitFor()
    await search.fill('')
    await expect.poll(shown).toEqual(['default', 'landing', 'plain'])
  })

  it('selects a site from the edit button of its row and moves focus to its card', async () => {
    const page = await open('reader@example.com')
    await card(page, 'Micelio').waitFor()
    await page.getByRole('button', { name: 'Edit Landing' }).click()
    await card(page, 'Landing').waitFor()
    await expect(card(page, 'Micelio').count()).resolves.toBe(0)
    await expect(
      page.locator(':focus').evaluate((node) => [node.tagName, node.textContent])
    ).resolves.toEqual(['H2', 'Landing'])
    await expect(card(page, 'Landing').getByLabel(/^Name/).inputValue()).resolves.toBe('Landing')
    await expect(card(page, 'Landing').getByLabel(/^Slug/).inputValue()).resolves.toBe('landing')
  })

  it('saves the name, slug, hosts, default locale and default site through the Content Manager and shows them after a reload, leaving the other fields as they were', async () => {
    const page = await open('writer@example.com')
    await page.getByRole('button', { name: 'Edit Landing' }).click()
    const landing = card(page, 'Landing')
    await expect
      .poll(() => landing.getByLabel(/^Name/).inputValue(), { timeout: 20_000 })
      .toBe('Landing')
    await landing.getByLabel(/^Name/).fill('Landing page')
    await landing.getByLabel(/^Slug/).fill('landing-page')
    await landing.getByLabel(/^Hosts/).fill('landing.example.test, www.landing.example.test')
    await landing.getByLabel(/^Default locale/).selectOption('es')
    await landing.getByRole('button', { name: 'Save' }).click()
    await page.getByRole('main').getByText('Saved.').waitFor()
    // The sites are loaded again: the table and the card's title show the new name.
    await card(page, 'Landing page').waitFor()
    await expect(table(page).getByText('Landing page', { exact: true }).count()).resolves.toBe(1)

    await page.reload()
    await page.getByRole('button', { name: 'Edit Landing page' }).click()
    const again = card(page, 'Landing page')
    await expect
      .poll(() => again.getByLabel(/^Slug/).inputValue(), { timeout: 20_000 })
      .toBe('landing-page')
    await expect(again.getByLabel(/^Hosts/).inputValue()).resolves.toBe(
      'landing.example.test, www.landing.example.test'
    )
    await expect(again.getByLabel(/^Default locale/).inputValue()).resolves.toBe('es')
    await expect(again.getByLabel('Answers requests that name no site').isChecked()).resolves.toBe(
      false
    )

    // The fields the page does not edit keep their values.
    const row = (await strapi.db.query(SITE_UID as UID.ContentType).findOne({
      where: { slug: 'landing-page', locale: 'en' },
      populate: { theme: true },
    })) as Record<string, unknown> & { theme: { themeId: string; themeVersion: string } }
    expect(row).toMatchObject({
      name: 'Landing page',
      hosts: ['landing.example.test', 'www.landing.example.test'],
      defaultLocale: 'es',
      isDefault: false,
      description: 'Kept as it was',
      tagline: 'A tagline kept too',
      timezone: 'America/Bogota',
    })
    expect(row.theme).toMatchObject({ themeId: 'starter', themeVersion: '1.2.0' })
  })

  it('shows the refusal of a host another site already has next to the form', async () => {
    const page = await open('writer@example.com')
    await page.getByRole('button', { name: 'Edit Plain' }).click()
    const plain = card(page, 'Plain')
    await expect
      .poll(() => plain.getByLabel(/^Slug/).inputValue(), { timeout: 20_000 })
      .toBe('plain')
    await plain.getByLabel(/^Hosts/).fill('demo.example.test')
    await plain.getByRole('button', { name: 'Save' }).click()
    const refusal = plain.locator('form').getByRole('alert')
    await expect(refusal.textContent()).resolves.toBe(
      'Another site already has the host "demo.example.test".'
    )
    // Nothing was written.
    const row = (await strapi.db
      .query(SITE_UID as UID.ContentType)
      .findOne({ where: { slug: 'plain', locale: 'en' } })) as { hosts: unknown }
    expect(row.hosts ?? []).toEqual([])
  })

  it('shows the fields read only and no Save to a role that may read but not update the Site type', async () => {
    const page = await open('reader@example.com')
    const micelio = card(page, 'Micelio')
    await expect
      .poll(() => micelio.getByLabel(/^Slug/).inputValue(), { timeout: 20_000 })
      .toBe('default')
    for (const label of [/^Name/, /^Slug/, /^Hosts/]) {
      await expect(
        micelio.getByLabel(label).getAttribute('readonly'),
        String(label)
      ).resolves.not.toBeNull()
    }
    await expect(micelio.getByLabel(/^Default locale/).isDisabled()).resolves.toBe(true)
    await expect(
      micelio.getByLabel('Answers requests that name no site').isDisabled()
    ).resolves.toBe(true)
    await expect(page.getByRole('button', { name: 'Save' }).count()).resolves.toBe(0)

    // The role that may update has the fields editable and the button.
    const writer = await open('writer@example.com')
    const own = card(writer, 'Micelio')
    await expect
      .poll(() => own.getByLabel(/^Slug/).inputValue(), { timeout: 20_000 })
      .toBe('default')
    await expect(own.getByLabel(/^Name/).getAttribute('readonly')).resolves.toBeNull()
    await expect(writer.getByRole('button', { name: 'Save' }).count()).resolves.toBe(1)
  })

  it('shows Create new site and Export site only to a role with their permission, with their links', async () => {
    const reader = await open('reader@example.com')
    await card(reader, 'Micelio').waitFor()
    await expect(reader.getByRole('link', { name: 'Create new site' }).count()).resolves.toBe(0)
    await expect(reader.getByRole('link', { name: 'Export site' }).count()).resolves.toBe(0)

    const maker = await open('maker@example.com')
    await card(maker, 'Micelio').waitFor()
    await expect(
      maker.getByRole('link', { name: 'Create new site' }).getAttribute('href')
    ).resolves.toMatch(/\/content-manager\/collection-types\/plugin::micelio\.site\/create$/)
    await expect(
      maker.getByRole('link', { name: 'Export site' }).getAttribute('href')
    ).resolves.toMatch(/\/plugins\/micelio\/_export-import\?site=default$/)
    // Each button is in the header of its place: Create in the page's, Export in the card's.
    await expect(
      card(maker, 'Micelio').getByRole('link', { name: 'Export site' }).count()
    ).resolves.toBe(1)
    // No update permission: no Save beside Export.
    await expect(maker.getByRole('button', { name: 'Save' }).count()).resolves.toBe(0)
  })

  it("renders each readable section's panel inside the site's card, under the form", async () => {
    const page = await open('reader@example.com')
    const micelio = card(page, 'Micelio')
    await micelio.getByText('Profile panel of default: handle unset, read only').waitFor()
    await expect(micelio.getByRole('heading', { name: 'Fixture profile' }).count()).resolves.toBe(1)
    await expect(
      micelio.getByRole('heading', { name: 'Fixture without a panel' }).count()
    ).resolves.toBe(1)
    const [form, panel] = await Promise.all([
      micelio.locator('form').boundingBox(),
      micelio.getByText('Profile panel of default').boundingBox(),
    ])
    expect(panel!.y).toBeGreaterThanOrEqual(form!.y + form!.height)
    // A box of its own, on the neutral background, inside the card.
    const box = micelio
      .getByRole('heading', { name: 'Fixture profile' })
      .locator('xpath=ancestor::section[1]')
    await expect(
      box.evaluate((node) => node.ownerDocument.defaultView!.getComputedStyle(node).backgroundColor)
    ).resolves.not.toBe(
      await micelio.evaluate(
        (node) => node.ownerDocument.defaultView!.getComputedStyle(node).backgroundColor
      )
    )
    // Nothing is outside a card: the panel is not a card of its own after the core's.
    await expect(page.locator('main section').count()).resolves.toBe(1 + 2)
  })

  it('has no accessibility violation, in English and in Spanish', async () => {
    for (const [email, ready] of [
      ['reader@example.com', 'Profile panel of default'],
      ['lector@example.com', 'Profile panel of default'],
    ] as const) {
      const page = await open(email)
      await page.getByText(ready).waitFor()
      if (email === 'lector@example.com') {
        await page
          .getByRole('main')
          .getByRole('heading', { level: 2, name: 'Micelio', exact: true })
          .waitFor()
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
