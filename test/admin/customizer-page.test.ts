import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
import en from '../../admin/src/translations/en.json'
import modulesSchema from '../../server/src/components/site/modules.json'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'
import { newContrastBehaviour, startPreviewSite, type PreviewSite } from '../strapi/preview-site'

const PAGE_UID = 'api::page.page'
const PASSWORD = 'Password1234'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']
const PIN = { themeId: 'bogota', themeVersion: '1.0.0', themeDigest: 'sha256-stub' }
const SITE_NAME = 'Micelio'
// The fields of the Site type the customizer reads, as the Content Manager names them.
const SITE_FIELDS = [
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
  theme?: {
    themeId: string | null
    themeVersion: string | null
    themeDigest: string | null
    defaultMode: string | null
    accentOverrides?: { mode: string; color: string }[]
  } | null
}

/** The body of one `POST /micelio/preview/token` the page sent. */
interface TokenBody {
  uid?: string
  documentId?: string
  accentOverrides?: { mode: string; color: string }[]
}

// The customizer in a browser (#61): the accent of each mode beside a frame of the site loaded with a
// token bound to the candidates, and the contrast matrix of the stub frontend's contrast route
// (`test/strapi/preview-site.ts`), which also records the `overrides` the CMS answered on each
// exchange.
describe('the customizer in the admin', () => {
  let strapi: Core.Strapi
  let base: string
  let site: PreviewSite
  let browser: Browser
  let siteId = ''
  let superAdminId = 0
  let admins = 0
  const contexts: BrowserContext[] = []

  async function login(roleId = superAdminId): Promise<{ page: Page; tokens: TokenBody[] }> {
    admins += 1
    const email = `customizer-${admins}@example.com`
    await strapi.service('admin::user').create({
      email,
      firstname: 'Admin',
      lastname: 'Test',
      password: PASSWORD,
      roles: [roleId],
      isActive: true,
    })
    // The admin's CSP of the test app does not list the stub's origin as a frame source.
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1200 },
      bypassCSP: true,
    })
    contexts.push(context)
    const page = await context.newPage()
    const tokens: TokenBody[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/micelio/preview/token')) {
        tokens.push(request.postDataJSON() as TokenBody)
      }
    })
    await page.goto(`${base}/admin/auth/login`)
    await page.locator('input[name="email"]').fill(email)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL(/\/admin(?!\/auth)/)
    return { page, tokens }
  }

  /** A logged-in page on the customizer of the default site, with its frame loaded. */
  async function open(): Promise<{ page: Page; tokens: TokenBody[] }> {
    const opened = await login()
    const exchanges = site.exchanges
    await opened.page.goto(`${base}/admin/plugins/micelio/customize/live?site=default&locale=en`)
    await heading(opened.page).waitFor()
    // The hidden frame of the contrast check and the live frame, each with a token of its own.
    await eventually(() => site.exchanges - exchanges).toBe(2)
    await eventually(() => opened.page.getByTestId('contrast-matrix').count()).toBe(1)
    return opened
  }

  const heading = (page: Page) =>
    page.getByRole('heading', { level: 1, name: `Customize ${SITE_NAME}` })
  const save = (page: Page) => page.getByRole('button', { name: en['customize.save'], exact: true })
  const discard = (page: Page) =>
    page.getByRole('button', { name: en['customize.discard'], exact: true })
  const tab = (page: Page, mode: string) => page.getByRole('tab', { name: mode, exact: true })
  const accent = (page: Page, mode: string) => page.getByLabel(`Accent of ${mode}`, { exact: true })
  const liveFrame = (page: Page) => page.locator(`iframe[title="Live preview of ${SITE_NAME}"]`)
  const summary = (page: Page) => page.getByTestId('customizer-summary')
  const matrix = (page: Page) => page.getByTestId('contrast-matrix')

  /** The `src` of every live frame in the page: a new token loads in a frame stacked on the old one. */
  const frameSources = (page: Page) =>
    liveFrame(page).evaluateAll((frames) => frames.map((frame) => frame.getAttribute('src')))

  /** Presses Tab (or Shift+Tab) until `target` has the focus; fails after `limit` presses. */
  async function tabTo(page: Page, target: Locator, backwards = false, limit = 60): Promise<void> {
    for (let press = 0; press < limit; press += 1) {
      if (await target.evaluate((node) => node === node.ownerDocument.activeElement)) return
      await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab')
    }
    throw new Error(`The focus never reached ${target.toString()}`)
  }

  async function stored(): Promise<SiteRow> {
    return (await strapi.documents(SITE_UID as UID.ContentType).findOne({
      documentId: siteId,
      locale: 'en',
      populate: ['theme.accentOverrides'] as never,
    })) as unknown as SiteRow
  }

  async function setStored(data: object): Promise<void> {
    await strapi.documents(SITE_UID as UID.ContentType).update({
      documentId: siteId,
      locale: 'en',
      data: data as never,
    })
  }

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    base = `http://127.0.0.1:${(strapi.server.httpServer.address() as AddressInfo).port}`
    site = await startPreviewSite()
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    const defaultSite = (await sites.findFirst({ filters: { isDefault: true } })) as {
      documentId: string
    }
    siteId = defaultSite.documentId
    await setStored({ url: site.origin, tagline: 'Notes in English', theme: PIN })
    const apiToken = (await strapi.service('admin::api-token').create({
      name: 'customizer-page-test',
      type: 'custom',
      lifespan: null,
      permissions: ['plugin::micelio.preview.exchange', 'plugin::micelio.preview.draft'],
    })) as { accessKey: string }
    site.connect({ base, apiToken: apiToken.accessKey, adminOrigin: base })
    // The page the customizer previews and checks the contrast against (decision D2 of #60).
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
    browser = await chromium.launch()
  })

  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close()
    site.contrast = newContrastBehaviour()
    await setStored({ tagline: 'Notes in English', theme: PIN })
  })

  afterAll(async () => {
    await browser?.close()
    await site?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
  })

  it('opens from Open with live preview on the Customize page and returns there on Close', async () => {
    const { page } = await login()
    await page.goto(`${base}/admin/plugins/micelio/customize`)
    await page.getByRole('heading', { level: 1, name: en['customize.title'] }).waitFor()
    await page.getByRole('link', { name: en['customize.live.open'] }).click()
    await heading(page).waitFor()
    expect(new URL(page.url()).pathname).toBe('/admin/plugins/micelio/customize/live')
    expect(new URL(page.url()).searchParams.get('site')).toBe('default')
    // No item of its own in the sub-navigation.
    await expect(
      page.getByRole('link', { name: en['customizer.title'], exact: true }).count()
    ).resolves.toBe(0)
    await eventually(() => summary(page).innerText()).toBe('Theme bogota 1.0.0 · no mode changed')

    await page.getByRole('link', { name: en['customizer.close'] }).click()
    await page.getByRole('heading', { level: 1, name: en['customize.title'] }).waitFor()
    expect(new URL(page.url()).pathname).toBe('/admin/plugins/micelio/customize')
    await expect(page.getByLabel(en['customize.site'], { exact: true }).inputValue()).resolves.toBe(
      siteId
    )

    // Another site, in es: the customizer opens for it, and Close comes back to it, not the default.
    const other = await strapi.documents(SITE_UID as UID.ContentType).create({
      locale: 'en',
      data: { name: 'Second site', slug: 'second-site', modules: { support: true } } as never,
    })
    await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' })
    await strapi.documents(SITE_UID as UID.ContentType).update({
      documentId: other.documentId,
      locale: 'es',
      data: { name: 'Segundo sitio' } as never,
    })
    await page.reload()
    await page.getByLabel(en['customize.site'], { exact: true }).selectOption(other.documentId)
    await page.getByLabel(en['customize.locale'], { exact: true }).selectOption('es')
    await page.getByRole('link', { name: en['customize.live.open'] }).click()
    await page.getByRole('heading', { level: 1, name: 'Customize Segundo sitio' }).waitFor()
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({
      site: 'second-site',
      locale: 'es',
    })
    await page.getByRole('link', { name: en['customizer.close'] }).click()
    await page.getByRole('heading', { level: 1, name: en['customize.title'] }).waitFor()
    await expect(page.getByLabel(en['customize.site'], { exact: true }).inputValue()).resolves.toBe(
      other.documentId
    )
    await expect(
      page.getByLabel(en['customize.locale'], { exact: true }).inputValue()
    ).resolves.toBe('es')
    await strapi.documents(SITE_UID as UID.ContentType).delete({ documentId: other.documentId })
  })

  it('edits the dark accent and loads the frame with a new token bound to it, without reloading the page', async () => {
    const { page, tokens } = await open()
    // The first frame's token carries no override: the saved accents.
    expect(tokens.map((body) => 'accentOverrides' in body)).toEqual([false, false])
    expect(site.exchangedOverrides.slice(-2)).toEqual([null, null])
    const [first] = await frameSources(page)
    await page.evaluate("window.customizerMark = 'still here'")
    const loads = site.draftLoads

    await tab(page, 'dark').click()
    await accent(page, 'dark').fill('#3f8a56')
    await eventually(() => site.exchangedOverrides.at(-1)).toEqual({
      accentOverrides: [{ mode: 'dark', color: '#3f8a56' }],
    })
    expect(tokens.at(-1)?.accentOverrides).toEqual([{ mode: 'dark', color: '#3f8a56' }])
    // The frame loads the new token's draft; the admin page is the same document.
    await eventually(async () => (await frameSources(page)).at(-1)).not.toBe(first)
    await eventually(() => site.draftLoads).toBeGreaterThan(loads)
    await expect(page.evaluate('window.customizerMark')).resolves.toBe('still here')
    await expect(summary(page).innerText()).resolves.toBe(
      'Theme bogota 1.0.0 · 1 of 2 modes changed · not saved'
    )
    await expect(page.getByTestId('customizer-live').innerText()).resolves.toMatch(
      /the unsaved accents applied$/
    )
  })

  it('asks for one token when the editor stops typing, not one per key', async () => {
    const { page, tokens } = await open()
    const asked = tokens.length
    await tab(page, 'dark').click()
    await accent(page, 'dark').click()
    // Six colours a site can store, one after another at a typist's pace (each key held 50 ms,
    // about 150 ms a colour), each well inside the pause the customizer waits for: the last digit
    // is selected and typed over, so no value in between is invalid, and a customizer without the
    // pause would ask a token for each.
    await page.keyboard.type('#3f8a50', { delay: 50 })
    for (const digit of ['1', '2', '3', '4', '5', '6']) {
      await page.keyboard.press('End', { delay: 50 })
      await page.keyboard.press('Shift+ArrowLeft', { delay: 50 })
      await page.keyboard.press(digit, { delay: 50 })
    }
    await expect(accent(page, 'dark').inputValue()).resolves.toBe('#3f8a56')
    await eventually(() => site.exchangedOverrides.at(-1)).toEqual({
      accentOverrides: [{ mode: 'dark', color: '#3f8a56' }],
    })
    // Any token asked for an earlier key would have been asked before this one.
    expect(tokens.slice(asked)).toEqual([
      expect.objectContaining({ accentOverrides: [{ mode: 'dark', color: '#3f8a56' }] }),
    ])
  })

  it("updates the matrix of the dark mode with the contrast route's answer for the candidate", async () => {
    const { page } = await open()
    await tab(page, 'dark').click()
    await expect(matrix(page).innerText()).resolves.toMatch(
      /accent on surface\s+5\.12:1\s+4\.5:1\s+AA/
    )
    // The frontend measures this candidate lower on the sunken surface, as given.
    site.contrast.modes.dark = {
      accent: 'candidate',
      pairs: [
        { role: 'accent', surface: 'surface', ratio: 7.01, min: 4.5, passes: true },
        { role: 'link', surface: 'surface-sunken', ratio: 3.1, min: 4.5, passes: false },
      ],
    }
    await accent(page, 'dark').fill('#5aa06e')
    await eventually(() => matrix(page).innerText()).toMatch(
      /accent on surface\s+7\.01:1\s+4\.5:1\s+AA\s+link on surface-sunken\s+3\.10:1\s+4\.5:1\s+Fails/
    )
    expect(site.contrast.requests.at(-1)?.accents).toEqual(['dark:#5aa06e'])
    await expect(save(page).isDisabled()).resolves.toBe(true)
    await expect(page.getByTestId('contrast-failures').innerText()).resolves.toMatch(
      /dark: #5aa06e fails AA \(link on surface-sunken is 3\.10:1, the minimum is 4\.5:1\)/
    )
  })

  it('disables Save while the dark accent is adjusted, with the reason, and saves the shade it offers', async () => {
    // The frontend would move any dark candidate to #1f5a34, the nearest shade that passes.
    site.contrast.modes.dark = {
      accent: '#1f5a34',
      pairs: [{ role: 'accent', surface: 'surface', ratio: 4.61, min: 4.5, passes: true }],
    }
    const { page } = await open()
    await tab(page, 'dark').click()
    await accent(page, 'dark').fill('#3f8a56')
    const failures = page.getByTestId('contrast-failures')
    await eventually(() => failures.count()).toBe(1)
    await expect(failures.innerText()).resolves.toBe(
      `${en['customizer.save.disabled']}\n\ndark: #3f8a56 fails AA, and the site would show #1f5a34 instead (accent on surface is 4.61:1, the minimum is 4.5:1). Use #1f5a34 or another accent to save.`
    )
    await expect(save(page).isDisabled()).resolves.toBe(true)

    await page.getByRole('button', { name: 'Use #1f5a34' }).click()
    await expect(accent(page, 'dark').inputValue()).resolves.toBe('#1f5a34')
    await eventually(() => failures.count()).toBe(0)
    await eventually(() => save(page).isEnabled()).toBe(true)
    await save(page).click()
    await page.getByRole('status').filter({ hasText: en['customize.save.done'] }).waitFor()
    const row = await stored()
    expect(row.theme?.accentOverrides).toMatchObject([{ mode: 'dark', color: '#1f5a34' }])
    // Nothing else of the site is written: the pin and the tagline are as they were.
    expect(row.theme).toMatchObject(PIN)
    expect(row.tagline).toBe('Notes in English')
    await eventually(() => summary(page).innerText()).toBe('Theme bogota 1.0.0 · no mode changed')
  })

  it('discards every change and loads the frame with a token that carries none', async () => {
    await setStored({ theme: { ...PIN, accentOverrides: [{ mode: 'light', color: '#276a3f' }] } })
    const { page, tokens } = await open()
    await expect(accent(page, 'light').inputValue()).resolves.toBe('#276a3f')
    await tab(page, 'dark').click()
    await accent(page, 'dark').fill('#3f8a56')
    await eventually(() => site.exchangedOverrides.at(-1)).toEqual({
      accentOverrides: [
        { mode: 'dark', color: '#3f8a56' },
        { mode: 'light', color: '#276a3f' },
      ],
    })
    await tab(page, 'light').click()
    await page.getByRole('button', { name: en['customizer.accent.reset'] }).click()
    await expect(summary(page).innerText()).resolves.toBe(
      'Theme bogota 1.0.0 · 2 of 2 modes changed · not saved'
    )
    // The light mode back to the theme's own: the frame gets the dark candidate alone.
    await eventually(() => site.exchangedOverrides.at(-1)).toEqual({
      accentOverrides: [{ mode: 'dark', color: '#3f8a56' }],
    })
    const asked = tokens.length

    await discard(page).click()
    await eventually(() => site.exchangedOverrides.at(-1)).toBeNull()
    expect(tokens.slice(asked)).toHaveLength(1)
    expect(tokens.at(-1)).not.toHaveProperty('accentOverrides')
    await expect(accent(page, 'light').inputValue()).resolves.toBe('#276a3f')
    await tab(page, 'dark').click()
    await expect(accent(page, 'dark').inputValue()).resolves.toBe('')
    await expect(summary(page).innerText()).resolves.toBe('Theme bogota 1.0.0 · no mode changed')
    await expect(page.getByTestId('customizer-live').innerText()).resolves.toMatch(
      /the saved accents$/
    )
    await expect((await stored()).theme?.accentOverrides).toEqual([
      expect.objectContaining({ mode: 'light', color: '#276a3f' }),
    ])
  })

  it('does every action with the keyboard alone', async () => {
    site.contrast.modes.dark = {
      accent: '#1f5a34',
      pairs: [{ role: 'accent', surface: 'surface', ratio: 4.61, min: 4.5, passes: true }],
    }
    const { page } = await open()
    const close = page.getByRole('link', { name: en['customizer.close'] })
    // In the order the page shows them: Close, the mode tabs, then the accent of the selected mode.
    await tabTo(page, close)
    await page.keyboard.press('Tab')
    await expect(
      tab(page, 'light').evaluate((node) => node === node.ownerDocument.activeElement)
    ).resolves.toBe(true)
    await page.keyboard.press('ArrowRight')
    await eventually(() => tab(page, 'dark').getAttribute('aria-selected')).toBe('true')
    await tabTo(page, accent(page, 'dark'))
    await page.keyboard.type('#3f8a56')
    const use = page.getByRole('button', { name: 'Use #1f5a34' })
    await use.waitFor()
    await tabTo(page, use)
    await page.keyboard.press('Enter')
    await eventually(() => accent(page, 'dark').inputValue()).toBe('#1f5a34')
    // The button is gone with the failure: the focus is back on the field, not lost.
    await expect(
      accent(page, 'dark').evaluate((node) => node === node.ownerDocument.activeElement)
    ).resolves.toBe(true)
    await eventually(() => save(page).isEnabled()).toBe(true)

    // Reset to theme, then Discard and Save, back up the page.
    const reset = page.getByRole('button', { name: en['customizer.accent.reset'] })
    await tabTo(page, reset)
    await page.keyboard.press('Enter')
    await eventually(() => accent(page, 'dark').inputValue()).toBe('')
    await expect(summary(page).innerText()).resolves.toBe('Theme bogota 1.0.0 · no mode changed')
    await tabTo(page, accent(page, 'dark'))
    await page.keyboard.type('#1f5a34')
    await eventually(() => save(page).isEnabled()).toBe(true)
    await tabTo(page, discard(page), true)
    await page.keyboard.press('Enter')
    await eventually(() => accent(page, 'dark').inputValue()).toBe('')
    await tabTo(page, accent(page, 'dark'))
    await page.keyboard.type('#1f5a34')
    await eventually(() => save(page).isEnabled()).toBe(true)
    await tabTo(page, save(page), true)
    await page.keyboard.press('Enter')
    await page.getByRole('status').filter({ hasText: en['customize.save.done'] }).waitFor()
    expect((await stored()).theme?.accentOverrides).toMatchObject([
      { mode: 'dark', color: '#1f5a34' },
    ])

    // Escape with something not saved asks first; Escape again stays, and the dialog's button leaves.
    await tabTo(page, accent(page, 'dark'))
    await page.keyboard.press('End')
    await page.keyboard.press('Backspace')
    await eventually(() => summary(page).innerText()).toMatch(/1 of 2 modes changed/)
    const dialog = page.getByRole('alertdialog')
    await page.keyboard.press('Escape')
    await dialog.waitFor()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await expect(heading(page).count()).resolves.toBe(1)
    await page.keyboard.press('Escape')
    await dialog.waitFor()
    const leave = dialog.getByRole('button', { name: en['customizer.confirm.leave'] })
    await tabTo(page, leave)
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { level: 1, name: en['customize.title'] }).waitFor()
    expect(new URL(page.url()).pathname).toBe('/admin/plugins/micelio/customize')

    // With nothing unsaved, Escape closes at once.
    await tabTo(page, page.getByRole('link', { name: en['customize.live.open'] }))
    await page.keyboard.press('Enter')
    await heading(page).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('heading', { level: 1, name: en['customize.title'] }).waitFor()
  })

  it('has no axe violation on the customizer', async () => {
    site.contrast.modes.dark = {
      accent: '#1f5a34',
      pairs: [{ role: 'accent', surface: 'surface', ratio: 4.61, min: 4.5, passes: true }],
    }
    const { page } = await open()
    await tab(page, 'dark').click()
    await accent(page, 'dark').fill('#3f8a56')
    await page.getByTestId('contrast-failures').waitFor()
    const results = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
    expect(
      results.violations.flatMap(({ id, nodes }) => nodes.map(({ target }) => ({ id, target })))
    ).toEqual([])
  })

  it('says why there is no frame to a role that may read the site and its page but not preview', async () => {
    const roles = strapi.service('admin::role')
    const role = (await roles.create({ name: 'Site editor', code: 'site-editor-no-preview' })) as {
      id: number
    }
    await roles.assignPermissions(role.id, [
      {
        action: 'plugin::content-manager.explorer.read',
        subject: SITE_UID,
        properties: { fields: SITE_FIELDS, locales: ['en'] },
        conditions: [],
      },
      {
        action: 'plugin::content-manager.explorer.read',
        subject: PAGE_UID,
        properties: { fields: ['title', 'slug', 'site'], locales: ['en'] },
        conditions: [],
      },
    ])
    const { page, tokens } = await login(role.id)
    const refused: number[] = []
    page.on('response', (answer) => {
      if (answer.url().endsWith('/micelio/preview/token')) refused.push(answer.status())
    })
    await page.goto(`${base}/admin/plugins/micelio/customize/live?site=default&locale=en`)
    await heading(page).waitFor()
    // The token route refuses the role, and the pane says why instead of staying blank.
    const reason = page.getByTestId('customizer-no-frame')
    await eventually(() => reason.count()).toBe(1)
    await expect(reason.innerText()).resolves.toBe(en['preview.error.forbidden'])
    expect(tokens.length).toBeGreaterThan(0)
    await eventually(() => refused.length).toBeGreaterThan(0)
    expect(refused.every((status) => status === 403)).toBe(true)
    await expect(liveFrame(page).count()).resolves.toBe(0)
    await expect(page.getByTestId('customizer-live').count()).resolves.toBe(0)
    // No Save or Discard either: the role may not update the site.
    await expect(save(page).count()).resolves.toBe(0)
    await expect(discard(page).count()).resolves.toBe(0)
  })
})
