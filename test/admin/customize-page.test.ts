import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
import en from '../../admin/src/translations/en.json'
import modulesSchema from '../../server/src/components/site/modules.json'
import { PREVIEW_PERMISSION } from '../../server/src/constants/preview'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'
import { newContrastBehaviour, startPreviewSite, type PreviewSite } from '../strapi/preview-site'

const PAGE_UID = 'api::page.page'
const PASSWORD = 'Password1234'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']
// A 1×1 PNG: the Media Library makes its thumbnail and reads its size from it.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

// The fields of the Site type the page reads, as the Content Manager names them: a component's by
// the path of each of its fields.
const READ_FIELDS = [
  'name',
  'slug',
  'tagline',
  'description',
  'logo',
  'author.name',
  'author.url',
  ...Object.keys(modulesSchema.attributes).map((key) => `modules.${key}`),
  'socialLinks.network',
  'socialLinks.url',
  'theme.themeId',
  'theme.themeVersion',
  'theme.themeDigest',
  'theme.defaultMode',
  'theme.displayFont',
  'theme.accentOverrides.mode',
  'theme.accentOverrides.color',
]

const eventually = <T>(read: () => Promise<T> | T) => expect.poll(read, { timeout: 20_000 })

interface SiteRow {
  tagline: string | null
  timezone: string | null
  contactEmail: string | null
  logo?: { id: number } | null
  author?: { name: string; url: string | null } | null
  modules?: Record<string, boolean>
  socialLinks?: { network: string; url: string }[]
  theme?: {
    themeId: string | null
    themeVersion: string | null
    themeDigest: string | null
    accentOverrides?: { mode: string; color: string }[]
  } | null
}

// The Customize page in a browser (#60): the save of the site's fields through the Content Manager,
// one locale at a time, the logo, the author, the social links and modules, and the AA result of
// each accent from the stub frontend's contrast route (`test/strapi/preview-site.ts`).
describe('the Customize page in the admin', () => {
  let strapi: Core.Strapi
  let base: string
  let site: PreviewSite
  let browser: Browser
  let siteId = ''
  let superAdminId = 0
  let readerRoleId = 0
  let admins = 0
  let adminToken: string | undefined
  const contexts: BrowserContext[] = []

  async function createUser(roleId: number): Promise<string> {
    admins += 1
    const email = `customize-${admins}@example.com`
    await strapi.service('admin::user').create({
      email,
      firstname: 'Admin',
      lastname: 'Test',
      password: PASSWORD,
      roles: [roleId],
      isActive: true,
    })
    return email
  }

  /** A logged-in page on the Customize page, for a new admin user of the role (the logins of one account are rate limited). */
  async function open(roleId = superAdminId): Promise<Page> {
    const email = await createUser(roleId)
    // The admin's CSP of the test app does not list the stub's origin as a frame source.
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1200 },
      bypassCSP: true,
    })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto(`${base}/admin/auth/login`)
    await page.locator('input[name="email"]').fill(email)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL(/\/admin(?!\/auth)/)
    await page.goto(`${base}/admin/plugins/micelio/customize`)
    await page.getByRole('heading', { level: 1, name: en['customize.title'] }).waitFor()
    await field(page, en['customize.name']).waitFor()
    return page
  }

  // A required field's label ends with a mark that is hidden from the accessible name.
  const field = (page: Page, label: string) =>
    page.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\*)?$`))
  const save = (page: Page) => page.getByRole('button', { name: en['customize.save'], exact: true })
  const chip = (page: Page, mode: string) => page.getByTestId(`chip-${mode}`)
  const saved = (page: Page) =>
    page.getByRole('status').filter({ hasText: en['customize.save.done'] })

  async function stored(locale = 'en'): Promise<SiteRow> {
    return (await strapi.documents(SITE_UID as UID.ContentType).findOne({
      documentId: siteId,
      locale,
      populate: ['logo', 'author', 'modules', 'socialLinks', 'theme.accentOverrides'] as never,
    })) as unknown as SiteRow
  }

  async function setStored(data: object): Promise<void> {
    await strapi.documents(SITE_UID as UID.ContentType).update({
      documentId: siteId,
      locale: 'en',
      data: data as never,
    })
  }

  async function token(email: string): Promise<string> {
    if (!adminToken) {
      const login = await fetch(`${base}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD }),
      })
      adminToken = ((await login.json()) as { data: { token: string } }).data.token
    }
    return adminToken
  }

  const optionsOf = (select: Locator) =>
    select.locator('option').evaluateAll((options) =>
      options.map((option) => ({
        value: option.getAttribute('value') ?? '',
        text: option.textContent,
      }))
    )

  const valuesOf = async (select: Locator) => (await optionsOf(select)).map(({ value }) => value)

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    base = `http://127.0.0.1:${(strapi.server.httpServer.address() as AddressInfo).port}`
    site = await startPreviewSite()
    await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' })
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    const defaultSite = (await sites.findFirst({ filters: { isDefault: true } })) as {
      documentId: string
    }
    siteId = defaultSite.documentId
    // The pin and two fields the page does not edit, which a save keeps.
    await sites.update({
      documentId: siteId,
      locale: 'en',
      data: {
        url: site.origin,
        tagline: 'Notes in English',
        timezone: 'America/Bogota',
        contactEmail: 'hello@example.test',
        theme: { themeId: 'bogota', themeVersion: '1.0.0', themeDigest: 'sha256-stub' },
      } as never,
    })
    await sites.update({
      documentId: siteId,
      locale: 'es',
      data: { name: 'Micelio', tagline: 'Notas en español' } as never,
    })
    const apiToken = (await strapi.service('admin::api-token').create({
      name: 'customize-page-test',
      type: 'custom',
      lifespan: null,
      permissions: ['plugin::micelio.preview.exchange', 'plugin::micelio.preview.draft'],
    })) as { accessKey: string }
    site.connect({ base, apiToken: apiToken.accessKey, adminOrigin: base })
    // The page the grant of the contrast check is for (decision D2 of #60).
    await strapi.documents(PAGE_UID as UID.ContentType).create({
      locale: 'en',
      data: {
        title: 'Home',
        slug: 'home',
        site: siteId,
        sections: [{ __component: 'shared.rich-text', body: 'Welcome.' }],
      } as never,
    })
    const superAdmin = (await strapi.db
      .query('admin::role')
      .findOne({ where: { code: 'strapi-super-admin' } })) as { id: number }
    superAdminId = superAdmin.id
    // Reads the Site type and may preview; may not update it.
    const roles = strapi.service('admin::role')
    const reader = (await roles.create({ name: 'Site reader', code: 'site-reader' })) as {
      id: number
    }
    await roles.assignPermissions(reader.id, [
      {
        action: 'plugin::content-manager.explorer.read',
        subject: SITE_UID,
        // The Content Manager answers a role only the fields and locales its grant lists.
        properties: { fields: READ_FIELDS, locales: ['en', 'es'] },
        conditions: [],
      },
      { action: PREVIEW_PERMISSION, subject: null, properties: {}, conditions: [] },
    ])
    readerRoleId = reader.id
    browser = await chromium.launch()
  })

  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close()
    site.contrast = newContrastBehaviour()
  })

  afterAll(async () => {
    await browser?.close()
    await site?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
  })

  it('saves a new tagline and a module turned off, and the site entry holds both', async () => {
    const page = await open()
    const tagline = field(page, en['customize.tagline'])
    await eventually(() => tagline.inputValue()).toBe('Notes in English')
    await expect(save(page).isDisabled()).resolves.toBe(true)
    await tagline.fill('Notes on the city')
    const support = page.getByRole('switch', { name: en['customize.module.support.name'] })
    await expect(support.isChecked()).resolves.toBe(true)
    await support.uncheck()
    await save(page).click()
    await saved(page).waitFor()

    const row = await stored()
    expect(row.tagline).toBe('Notes on the city')
    expect(row.modules?.support).toBe(false)
    expect(row.modules?.newsletter).toBe(true)
    // What the page does not edit keeps its value, and the pin is sent back as read.
    expect(row.timezone).toBe('America/Bogota')
    expect(row.contactEmail).toBe('hello@example.test')
    expect(row.theme).toMatchObject({
      themeId: 'bogota',
      themeVersion: '1.0.0',
      themeDigest: 'sha256-stub',
    })
    await setStored({ modules: { support: true } })
  })

  it('edits the tagline in es and keeps the en one', async () => {
    const page = await open()
    await eventually(() => chip(page, 'light').innerText()).toMatch(/Theme's accent/)
    const exchanges = site.exchanges
    await page.getByLabel(en['customize.locale'], { exact: true }).selectOption('es')
    const tagline = field(page, en['customize.tagline'])
    await eventually(() => tagline.inputValue()).toBe('Notas en español')
    // The contrast check survives the switch, with the same grant: no new token is exchanged.
    await expect(chip(page, 'light').innerText()).resolves.toMatch(/Theme's accent/)
    await expect(page.getByTestId('contrast-unchecked').count()).resolves.toBe(0)
    expect(site.exchanges).toBe(exchanges)
    await tagline.fill('Notas sobre la ciudad')
    await save(page).click()
    await saved(page).waitFor()

    expect((await stored('es')).tagline).toBe('Notas sobre la ciudad')
    const english = (await stored('en')).tagline
    expect(english).not.toBe('Notas sobre la ciudad')
    expect(english).toMatch(/^Notes/)
  })

  it('offers no form and no save in a locale the site has no version of, and keeps the shared fields', async () => {
    // A site in English only: the Content Manager answers its `es` read with an empty `data`.
    const landing = await strapi.documents(SITE_UID as UID.ContentType).create({
      locale: 'en',
      data: {
        name: 'Landing',
        slug: 'landing-en-only',
        modules: { support: false },
        socialLinks: [{ network: 'codeberg', url: 'https://codeberg.org/landing' }],
        theme: {
          themeId: 'starter',
          themeVersion: '1.2.0',
          themeDigest: 'sha256-landing',
          displayFont: 'archivo',
          defaultMode: 'dark',
          accentOverrides: [{ mode: 'light', color: '#276a3f' }],
        },
      } as never,
    })
    const page = await open()
    await page.getByLabel(en['customize.site'], { exact: true }).selectOption(landing.documentId)
    await eventually(() => field(page, en['customize.name']).inputValue()).toBe('Landing')
    await page.getByLabel(en['customize.locale'], { exact: true }).selectOption('es')
    await page
      .getByRole('alert')
      .filter({ hasText: en['customize.entry.missing'].replace('{locale}', 'es') })
      .waitFor()
    await expect(field(page, en['customize.name']).count()).resolves.toBe(0)
    await expect(save(page).count()).resolves.toBe(0)

    // Nothing was written: the English entry keeps every field every locale shares.
    const kept = (await strapi.documents(SITE_UID as UID.ContentType).findOne({
      documentId: landing.documentId,
      locale: 'en',
      populate: ['modules', 'socialLinks', 'theme.accentOverrides'] as never,
    })) as unknown as SiteRow & { theme: { displayFont: string; defaultMode: string } }
    expect(kept.modules?.support).toBe(false)
    expect(kept.socialLinks).toMatchObject([
      { network: 'codeberg', url: 'https://codeberg.org/landing' },
    ])
    expect(kept.theme).toMatchObject({
      themeId: 'starter',
      themeVersion: '1.2.0',
      themeDigest: 'sha256-landing',
      displayFont: 'archivo',
      defaultMode: 'dark',
      accentOverrides: [{ mode: 'light', color: '#276a3f' }],
    })
    await strapi.documents(SITE_UID as UID.ContentType).delete({ documentId: landing.documentId })
  })

  it('picks a logo from the media library and sets the default author', async () => {
    const page = await open()
    const email = `customize-${admins}@example.com`
    const form = new FormData()
    form.append('files', new Blob([PNG], { type: 'image/png' }), 'site-logo.png')
    const upload = await fetch(`${base}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token(email)}` },
      body: form,
    })
    expect(upload.status).toBe(201)
    const [file] = (await upload.json()) as { id: number }[]

    await expect(page.getByTestId('customize-logo').innerText()).resolves.toBe(
      en['customize.logo.none']
    )
    await page.getByRole('button', { name: en['customize.logo.choose'] }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    await dialog.getByRole('checkbox', { name: /site-logo/ }).check()
    await dialog.getByRole('button', { name: 'Finish' }).click()
    await dialog.waitFor({ state: 'hidden' })
    await eventually(() => page.getByTestId('customize-logo').innerText()).toBe('site-logo.png')

    await field(page, en['customize.author.name']).fill('Ada Lovelace')
    const url = field(page, en['customize.author.url'])
    await url.fill('not a url')
    await page.getByText(en['customize.url.invalid']).waitFor()
    await expect(save(page).isDisabled()).resolves.toBe(true)
    await url.fill('https://ada.example.test')
    await save(page).click()
    await saved(page).waitFor()

    const row = await stored()
    expect(row.logo?.id).toBe(file!.id)
    expect(row.author).toMatchObject({ name: 'Ada Lovelace', url: 'https://ada.example.test' })
  })

  it('adds a mastodon link from the networks of the enum only, and removes it', async () => {
    const page = await open()
    await page.getByRole('button', { name: en['customize.social.add'] }).click()
    const row = page.getByRole('group', { name: 'Link 1' })
    const network = row.getByLabel(en['customize.social.network'])
    await expect(valuesOf(network)).resolves.toEqual([
      'github',
      'gitlab',
      'codeberg',
      'linkedin',
      'mastodon',
      'bluesky',
      'x',
      'website',
    ])
    await network.selectOption('mastodon')
    const url = row.getByLabel(en['customize.social.url'])
    await url.fill('social.example.test/@demo')
    await expect(save(page).isDisabled()).resolves.toBe(true)
    await url.fill('https://social.example.test/@demo')
    await save(page).click()
    await saved(page).waitFor()
    expect((await stored()).socialLinks).toMatchObject([
      { network: 'mastodon', url: 'https://social.example.test/@demo' },
    ])

    await page.getByRole('button', { name: 'Remove the mastodon link' }).click()
    await page.getByText(en['customize.social.none']).waitFor()
    await save(page).click()
    await saved(page).waitFor()
    await eventually(async () => (await stored()).socialLinks).toEqual([])
  })

  it('offers the five display fonts and the modes the contrast route lists as the default mode', async () => {
    site.contrast.modes = {
      light: site.contrast.modes.light!,
      dark: site.contrast.modes.dark!,
      sepia: { accent: 'candidate', pairs: [] },
    }
    const page = await open()
    const font = field(page, en['customize.font'])
    await expect(optionsOf(font)).resolves.toEqual([
      { value: '', text: en['customize.themeDefault'] },
      { value: 'archivo', text: 'archivo' },
      { value: 'fraunces', text: 'fraunces' },
      { value: 'bricolage-grotesque', text: 'bricolage-grotesque' },
      { value: 'newsreader', text: 'newsreader' },
      { value: 'space-grotesk', text: 'space-grotesk' },
    ])
    const mode = field(page, en['customize.defaultMode'])
    await eventually(() => valuesOf(mode)).toEqual(['', 'light', 'dark', 'sepia'])
    await font.selectOption('newsreader')
    await mode.selectOption('dark')
    await save(page).click()
    await saved(page).waitFor()
    expect((await stored()).theme).toMatchObject({
      displayFont: 'newsreader',
      defaultMode: 'dark',
    })
    await setStored({
      theme: { themeId: 'bogota', themeVersion: '1.0.0', themeDigest: 'sha256-stub' },
    })
  })

  it("shows each mode's accent with the AA result the contrast route answers", async () => {
    await setStored({
      theme: {
        themeId: 'bogota',
        themeVersion: '1.0.0',
        themeDigest: 'sha256-stub',
        accentOverrides: [{ mode: 'light', color: '#276a3f' }],
      },
    })
    const page = await open()
    await page.getByTestId('customize-theme').getByText('bogota 1.0.0').waitFor()
    await eventually(() => chip(page, 'light').innerText()).toMatch(/light · #276a3f\s*·\s*AA/)
    await eventually(() => chip(page, 'dark').innerText()).toMatch(
      /dark · theme\s*·\s*Theme's accent/
    )
    // The route was asked with the editor's grant, for the page, with the saved candidate.
    const asked = site.contrast.requests.at(-1)!
    expect(asked.hasGrant).toBe(true)
    expect(asked.accents).toEqual(['light:#276a3f'])
    expect(asked.documentId).toMatch(/\w+/)
    await expect(save(page).isDisabled()).resolves.toBe(true)

    // Remove drops the override; the save stores none.
    await page.getByRole('button', { name: 'Remove the accent of light' }).click()
    await eventually(() => chip(page, 'light').innerText()).toMatch(/light · theme/)
    await save(page).click()
    await saved(page).waitFor()
    expect((await stored()).theme?.accentOverrides).toEqual([])
  })

  it('disables Save while an accent is adjusted, naming the mode and pair, and enables it after Use the nearest passing shade', async () => {
    // The frontend would move any light candidate to #1f5a34, the nearest shade that passes.
    site.contrast.modes.light = {
      accent: '#1f5a34',
      pairs: [{ role: 'accent', surface: 'surface', ratio: 4.61, min: 4.5, passes: true }],
    }
    const page = await open()
    await eventually(() => chip(page, 'light').innerText()).toMatch(/light · theme/)
    const asked = site.contrast.requests.length
    // Two colours one after the other: the route is asked once the value settles, for the last.
    await field(page, 'Accent of light').fill('#3f8a57')
    await field(page, 'Accent of light').fill('#3f8a56')
    await eventually(() => chip(page, 'light').innerText()).toMatch(
      /Fails: the site would show #1f5a34/
    )
    expect(site.contrast.requests.slice(asked).map(({ accents }) => accents)).toEqual([
      ['light:#3f8a56'],
    ])
    const failures = page.getByTestId('contrast-failures')
    await expect(failures.innerText()).resolves.toBe(
      'light: #3f8a56 fails AA, and the site would show #1f5a34 instead (accent on surface is 4.61:1, the minimum is 4.5:1). Use #1f5a34 or another accent to save.'
    )
    await expect(save(page).isDisabled()).resolves.toBe(true)

    await page.getByRole('button', { name: 'Use #1f5a34' }).click()
    await eventually(() => chip(page, 'light').innerText()).toMatch(/light · #1f5a34\s*·\s*AA/)
    await expect(failures.count()).resolves.toBe(0)
    await eventually(() => save(page).isEnabled()).toBe(true)
    await save(page).click()
    await saved(page).waitFor()
    expect((await stored()).theme?.accentOverrides).toMatchObject([
      { mode: 'light', color: '#1f5a34' },
    ])
    await setStored({
      theme: { themeId: 'bogota', themeVersion: '1.0.0', themeDigest: 'sha256-stub' },
    })
  })

  it('says the contrast was not checked and keeps Save when the contrast route answers 404', async () => {
    site.contrast.status = 404
    const page = await open()
    await page.getByTestId('contrast-unchecked').waitFor()
    await expect(page.getByTestId('contrast-unchecked').innerText()).resolves.toBe(
      en['customize.unchecked.unavailable']
    )
    // With no answer, the default mode offers the theme's default only.
    await expect(valuesOf(field(page, en['customize.defaultMode']))).resolves.toEqual([''])
    await field(page, en['customize.tagline']).fill('Saved without a check')
    await eventually(() => save(page).isEnabled()).toBe(true)
    await save(page).click()
    await saved(page).waitFor()
    expect((await stored()).tagline).toBe('Saved without a check')
  })

  it('shows the page without Save to a role that may read the Site type and not update it', async () => {
    const page = await open(readerRoleId)
    await eventually(() => field(page, en['customize.name']).inputValue()).not.toBe('')
    await expect(save(page).count()).resolves.toBe(0)
    await expect(
      page.getByRole('button', { name: en['customize.discard'], exact: true }).count()
    ).resolves.toBe(0)
    await expect(
      page.getByRole('button', { name: en['customize.social.add'] }).count()
    ).resolves.toBe(0)
    await expect(
      field(page, en['customize.tagline']).getAttribute('readonly')
    ).resolves.not.toBeNull()
    await expect(
      page.getByRole('switch', { name: en['customize.module.newsletter.name'] }).isDisabled()
    ).resolves.toBe(true)
  })

  it('has no axe violation on the Customize page', async () => {
    const page = await open()
    await eventually(() => chip(page, 'light').innerText()).toMatch(/light/)
    const results = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
    expect(
      results.violations.flatMap(({ id, nodes }) => nodes.map(({ target }) => ({ id, target })))
    ).toEqual([])
  })
})
