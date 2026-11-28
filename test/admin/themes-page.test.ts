import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
import { SITE_UID } from '../../server/src/constants/site'
import { THEME_ACTIVATION_UID } from '../../server/src/constants/themes'
import type { ThemePin } from '../../server/src/types/themes'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'
import { startPreviewSite, type PreviewSite } from '../strapi/preview-site'

// A page type made with `withPageSettings`: the theme preview offers the site's pages of such types.
const GUIDE_UID = 'api::guide.guide'
const PASSWORD = 'Password1234'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

/** `expect.poll` with the time a frame takes to load, or the frontend to switch. */
const eventually = <T>(read: () => Promise<T> | T) => expect.poll(read, { timeout: 20_000 })

describe('the Themes page in the admin', () => {
  let strapi: Core.Strapi
  let base: string
  let site: PreviewSite
  let browser: Browser
  let siteName = ''
  const contexts: BrowserContext[] = []

  let admins = 0
  let superAdminId = 0
  /** A super admin of its own: the token route is rate limited for each admin user. */
  async function newSuperAdmin(): Promise<string> {
    admins += 1
    const email = `themes-${admins}@example.com`
    await strapi.service('admin::user').create({
      email,
      firstname: 'Admin',
      lastname: 'Test',
      password: PASSWORD,
      roles: [superAdminId],
      isActive: true,
    })
    return email
  }

  /** A logged-in page of a context of its own, at `path`; `prepare` runs before it opens. */
  async function open(path: string, prepare?: (page: Page) => Promise<void>): Promise<Page> {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      bypassCSP: true,
    })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto(`${base}/admin/auth/login`)
    await page.locator('input[name="email"]').fill(await newSuperAdmin())
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL(/\/admin(?!\/auth)/)
    await prepare?.(page)
    await page.goto(`${base}/admin/plugins/micelio/${path}`)
    return page
  }

  /** Records the token requests and the draft pages of the frames, in the order they happen. */
  function recordPreview(page: Page): { tokens: Record<string, unknown>[]; order: string[] } {
    const tokens: Record<string, unknown>[] = []
    const order: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/micelio/preview/token')) {
        const body = request.postDataJSON() as Record<string, unknown>
        tokens.push(body)
        order.push('theme' in body ? 'token:candidate' : 'token:current')
      }
    })
    page.on('response', (response) => {
      if (response.url().startsWith(`${site.origin}/drafts/`)) order.push('draft')
    })
    return { tokens, order }
  }

  const card = (page: Page, theme: string) => page.locator(`article[data-theme-card="${theme}"]`)

  /** Waits for the page's animations to end: a dialog fades in. */
  const settled = (page: Page) =>
    page.waitForFunction('document.getAnimations().every((each) => each.playState !== "running")')

  /** The texts of a card's chips, in order. */
  const chipsOf = (target: Locator) => target.locator('[data-chip]').allTextContents()

  /** The accessible names of a card's links and buttons, in order. */
  const namesOf = (target: Locator) =>
    target
      .locator('a, button')
      .evaluateAll((all) => all.map((node) => node.getAttribute('aria-label') ?? node.textContent))

  async function violationsOf(page: Page, scope = 'main'): Promise<unknown[]> {
    const results = await new AxeBuilder({ page }).include(scope).withTags(WCAG_TAGS).analyze()
    return results.violations.flatMap(({ id, nodes }) =>
      nodes.map(({ target, failureSummary }) => ({ id, target, failureSummary }))
    )
  }

  async function defaultSite(): Promise<{
    id: number
    documentId: string
    theme: ThemePin | null
  }> {
    return (await strapi.db.query(SITE_UID).findOne({
      where: { isDefault: true },
      populate: { theme: true },
    })) as { id: number; documentId: string; theme: ThemePin | null }
  }

  async function setPin(theme: Partial<ThemePin> | null): Promise<void> {
    const { documentId } = await defaultSite()
    await strapi
      .documents(SITE_UID as UID.ContentType)
      .update({ documentId, data: { theme } as never })
  }

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    site = await startPreviewSite()
    // The stub's switch reads the default site's pin, as the frontend reads its site settings.
    site.themes.behaviour.readPin = async () => {
      const { theme } = await defaultSite()
      return theme
        ? {
            themeId: theme.themeId ?? null,
            themeVersion: theme.themeVersion ?? null,
            themeDigest: theme.themeDigest ?? null,
          }
        : null
    }
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    const seeded = (await sites.findFirst({ filters: { isDefault: true } })) as unknown as {
      documentId: string
      name: string
    }
    siteName = seeded.name
    await sites.update({ documentId: seeded.documentId, data: { url: site.origin } as never })
    await setPin({ themeId: 'bogota' })
    const apiToken = (await strapi.service('admin::api-token').create({
      name: 'themes-page-test',
      type: 'custom',
      lifespan: null,
      permissions: ['plugin::micelio.preview.exchange', 'plugin::micelio.preview.draft'],
    })) as { accessKey: string }
    site.connect({ base, apiToken: apiToken.accessKey, adminOrigin: base })
    // The seeded site's page the preview shows.
    await strapi.documents(GUIDE_UID as UID.ContentType).create({
      locale: 'en',
      data: {
        title: 'Field notes',
        slug: 'field-notes',
        site: seeded.documentId,
        sections: [{ __component: 'shared.rich-text', body: 'Notes on software and the city.' }],
      } as never,
    })
    const superAdmin = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    superAdminId = superAdmin.id
    browser = await chromium.launch()
  })

  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close()
  })

  afterAll(async () => {
    await browser?.close()
    await site?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
  })

  it('lists the installed themes with the active one marked', async () => {
    const page = await open('themes')
    await page.getByRole('heading', { level: 1, name: 'Themes' }).waitFor()
    await page.getByRole('tab', { name: 'Installed (2)', selected: true }).waitFor()
    await page
      .getByText(`${siteName} runs bogota 1.0.0. Preview any theme on your own pages`, {
        exact: false,
      })
      .waitFor()
    const bogota = card(page, 'bogota').first()
    await expect(bogota.getByRole('heading', { level: 3 }).textContent()).resolves.toBe('Bogotá')
    await expect(bogota.getByText('Active', { exact: true }).count()).resolves.toBe(1)
    await expect(
      bogota.getByText('bogota 1.0.0 · contract 2.3 · code theme', { exact: true }).count()
    ).resolves.toBe(1)
    await expect(chipsOf(bogota)).resolves.toContain('Admitted · AA · budgets pass')
    // The active theme offers Customize and its report, and neither a preview nor an activation.
    await expect(bogota.getByRole('link', { name: 'Customize' }).count()).resolves.toBe(1)
    await expect(
      bogota.getByRole('button', { name: 'Admission report: bogota 1.0.0' }).count()
    ).resolves.toBe(1)
    await expect(bogota.getByRole('link', { name: /^Preview/ }).count()).resolves.toBe(0)
    const starter = card(page, 'starter').first()
    await expect(starter.getByText('Installed', { exact: true }).count()).resolves.toBe(1)
    await expect(starter.getByText('Active', { exact: true }).count()).resolves.toBe(0)
    await expect(chipsOf(starter)).resolves.toEqual(
      expect.arrayContaining(['Admitted · AA · budgets pass', 'Activates without a rebuild'])
    )
    await expect(page.getByRole('button', { name: /Activate/ }).count()).resolves.toBe(0)
    await expect(
      starter.getByRole('link', { name: `Preview on ${siteName}: starter 1.2.0` }).count()
    ).resolves.toBe(1)
    // The admin never called the frontend: every request of the page went to the CMS.
    const calls: string[] = []
    page.on('request', (request) => calls.push(request.url()))
    await page.reload()
    await page.getByRole('tab', { name: 'Installed (2)' }).waitFor()
    expect(calls.filter((url) => url.startsWith(site.origin))).toEqual([])
  })

  it("lists the registry's themes with their admission report result, and the updates of the installed ones", async () => {
    const page = await open('themes')
    await page.getByRole('tab', { name: 'Available in the registry (3)' }).click()
    const registry = page.getByRole('tabpanel')
    const titles = await registry.getByRole('heading', { level: 3 }).allTextContents()
    // The registry lists no name: a registry card takes an installed theme's of the same id.
    expect(titles).toEqual(['Starter', 'sendero', 'mosaico'])
    const sendero = registry.locator('article[data-theme-card="sendero"]')
    await expect(sendero.getByText('Registry · official').count()).resolves.toBe(1)
    await expect(
      sendero.getByText('sendero 2.1.0 · contract 2.3 · data-only · MIT', { exact: true }).count()
    ).resolves.toBe(1)
    await expect(chipsOf(sendero)).resolves.toEqual([
      'Admitted · AA · budgets pass',
      'Activates without a rebuild',
    ])
    const mosaico = registry.locator('article[data-theme-card="mosaico"]')
    await expect(mosaico.getByText('Registry · community').count()).resolves.toBe(1)
    await expect(chipsOf(mosaico)).resolves.toEqual([
      'Refused at admission',
      'Needs an image built with it',
    ])

    await page.getByRole('tab', { name: 'Updates (1)' }).click()
    const update = page.getByRole('tabpanel').locator('article[data-theme-card="starter"]')
    await expect(update.getByRole('heading', { level: 3 }).textContent()).resolves.toBe(
      'Starter 1.3.0'
    )
    await expect(
      update.getByText('from 1.2.0 · minor · contract 2.3', { exact: true }).count()
    ).resolves.toBe(1)

    // A registry the frontend could not read shows its reason.
    const { catalogue } = site.themes.behaviour
    const registryBefore = catalogue.registry
    catalogue.registry = null
    catalogue.reason = 'the index did not verify'
    try {
      await page.reload()
      await page.getByRole('tab', { name: 'Available in the registry (0)' }).click()
      await page
        .getByText('The registry could not be read: the index did not verify', { exact: true })
        .waitFor()
    } finally {
      catalogue.registry = registryBefore
      catalogue.reason = null
    }
  })

  it("previews starter beside the active theme on a page of the seeded site, the candidate's token carrying the theme and the other's none", async () => {
    const page = await open('themes')
    const { tokens } = recordPreview(page)
    await card(page, 'starter')
      .first()
      .getByRole('link', { name: `Preview on ${siteName}: starter 1.2.0` })
      .click()
    await page.waitForURL(/\/plugins\/micelio\/themes\/preview\?/)
    await page
      .getByRole('heading', { level: 1, name: `Preview starter 1.2.0 on ${siteName}` })
      .waitFor()
    const current = page.frameLocator(
      'section[aria-label="Current · bogota 1.0.0"] iframe >> nth=-1'
    )
    const candidate = page.frameLocator(
      'section[aria-label="Candidate · starter 1.2.0"] iframe >> nth=-1'
    )
    await eventually(() => candidate.locator('html').getAttribute('data-theme')).toBe('starter')
    await eventually(() => current.locator('html').getAttribute('data-theme')).toBe('bogota')
    await expect(candidate.getByRole('heading', { level: 1 }).textContent()).resolves.toBe(
      'Field notes'
    )
    await expect(current.getByRole('heading', { level: 1 }).textContent()).resolves.toBe(
      'Field notes'
    )
    // One token each: the candidate's body carries the theme, the current one's none.
    expect(tokens).toHaveLength(2)
    const withTheme = tokens.filter((body) => 'theme' in body)
    expect(withTheme).toEqual([
      expect.objectContaining({ uid: GUIDE_UID, theme: { id: 'starter', version: '1.2.0' } }),
    ])
    expect(tokens.filter((body) => !('theme' in body))).toEqual([
      expect.objectContaining({ uid: GUIDE_UID }),
    ])
    // The theme is never in a frame's URL, and a preview activates nothing.
    const urls = page
      .frames()
      .filter((frame) => frame !== page.mainFrame())
      .map((frame) => frame.url())
    expect(urls.filter((url) => url.includes('starter') || url.includes('theme'))).toEqual([])
    await expect(strapi.db.query(THEME_ACTIVATION_UID as UID.ContentType).count()).resolves.toBe(0)
    expect((await defaultSite()).theme?.themeId).toBe('bogota')

    // The static site mode loads both frames again, with the same themes.
    await page.getByLabel('As static site').check()
    await eventually(() => tokens.length).toBe(4)
    await eventually(() => candidate.locator('html').getAttribute('data-theme')).toBe('starter')
    expect(tokens.slice(2).map((body) => 'theme' in body)).toEqual([false, true])
  })

  it("asks for the candidate's token only once the active theme's frame has loaded", async () => {
    const page = await open('themes/preview?site=default&theme=starter&version=1.2.0')
    const { order } = recordPreview(page)
    const candidate = page.frameLocator(
      'section[aria-label="Candidate · starter 1.2.0"] iframe >> nth=-1'
    )
    // The frontend keeps one grant per browser, in one cookie: the active theme's frame exchanges and
    // loads its draft before the candidate asks for its token.
    await eventually(() => order.length).toBe(4)
    expect(order).toEqual(['token:current', 'draft', 'token:candidate', 'draft'])
    await eventually(() => candidate.locator('html').getAttribute('data-theme')).toBe('starter')
    // The same order when both frames load again for the static site.
    await page.getByLabel('As static site').check()
    await eventually(() => order.length).toBe(8)
    expect(order.slice(4)).toEqual(['token:current', 'draft', 'token:candidate', 'draft'])
  })

  it('reloads neither frame on its own when the grant would end', async () => {
    const page = await open('themes/preview?site=default&theme=starter&version=1.2.0', (page) =>
      page.clock.install()
    )
    const { tokens, order } = recordPreview(page)
    const candidate = page.frameLocator(
      'section[aria-label="Candidate · starter 1.2.0"] iframe >> nth=-1'
    )
    await eventually(() => order.length).toBe(4)
    await eventually(() => candidate.locator('html').getAttribute('data-theme')).toBe('starter')
    // Past the 14 minutes after which a preview asks for a new token: the two frames share one grant
    // cookie, so neither asks on its own.
    await page.clock.fastForward('15:00')
    // A timer that fired would ask at once: no token request comes within three seconds.
    await expect(
      page.waitForRequest((request) => request.url().endsWith('/micelio/preview/token'), {
        timeout: 3000,
      })
    ).rejects.toThrow()
    expect(tokens).toHaveLength(2)
    expect(order).toEqual(['token:current', 'draft', 'token:candidate', 'draft'])
  })

  it('shows the reason and no frame, and asks for no token, for a candidate no store holds', async () => {
    // `sendero` is in the stub's registry and in none of its stores.
    const page = await open('themes/preview?site=default&theme=sendero&version=2.1.0')
    const { tokens } = recordPreview(page)
    await page.getByText('Not installed on this frontend', { exact: true }).waitFor()
    await page
      .getByText(
        "sendero 2.1.0 is in none of the frontend's theme stores, so it cannot be previewed: a preview installs nothing. Activating a data-only theme installs it."
      )
      .waitFor()
    const current = page.frameLocator(
      'section[aria-label="Current · bogota 1.0.0"] iframe >> nth=-1'
    )
    await eventually(() => current.locator('html').getAttribute('data-theme')).toBe('bogota')
    await expect(
      page.locator('section[aria-label="Candidate · sendero 2.1.0"] iframe').count()
    ).resolves.toBe(0)
    // One token, the active theme's: none was asked with the candidate's theme, and none again
    // when the static site loads the active theme's frame again.
    await eventually(() => tokens.length).toBe(1)
    await page.getByLabel('As static site').check()
    await eventually(() => tokens.length).toBe(2)
    expect(tokens.filter((body) => 'theme' in body)).toEqual([])
    expect(site.exchanges).toBeGreaterThan(0)
  })

  it('activates starter, shows it once the frontend reports it active, and reverts to the previous theme', async () => {
    const page = await open('themes')
    // A theme is activated from its preview, as the artboard does: the cards have no Activate.
    await card(page, 'starter')
      .first()
      .getByRole('link', { name: `Preview on ${siteName}: starter 1.2.0` })
      .click()
    await page.getByRole('button', { name: `Activate on ${siteName}` }).click()
    await page.getByText('The frontend now renders starter.', { exact: true }).waitFor()
    expect((await defaultSite()).theme).toMatchObject({
      themeId: 'starter',
      themeVersion: null,
      themeDigest: null,
    })
    await page.getByRole('link', { name: 'Back to Themes' }).click()
    await card(page, 'starter').first().getByText('Active', { exact: true }).waitFor()
    await expect(
      card(page, 'bogota').first().getByText('Active', { exact: true }).count()
    ).resolves.toBe(0)
    await page.getByText(`The last activation on ${siteName} replaced bogota.`).waitFor()

    await page.getByRole('button', { name: 'Revert to bogota' }).click()
    await page.getByText('The frontend now renders bogota.', { exact: true }).waitFor()
    expect((await defaultSite()).theme?.themeId).toBe('bogota')
    await expect(
      card(page, 'bogota').first().getByText('Active', { exact: true }).count()
    ).resolves.toBe(1)
    // A revert is not reverted: the bar is gone.
    await expect(page.getByRole('button', { name: /^Revert to/ }).count()).resolves.toBe(0)
    const rows = (await strapi.db.query(THEME_ACTIVATION_UID as UID.ContentType).findMany({
      orderBy: { id: 'asc' },
    })) as { action: string }[]
    expect(rows.map(({ action }) => action)).toEqual(['activate', 'revert'])
  })

  it('links to the site while it waits, and says the pin is not applied yet when the frontend has not reported it after three minutes', async () => {
    // A frontend that renders no page reads no new pin: its status keeps the active theme.
    const readPin = site.themes.behaviour.readPin
    site.themes.behaviour.readPin = async () => ({
      themeId: 'bogota',
      themeVersion: null,
      themeDigest: null,
    })
    try {
      const page = await open('themes/preview?site=default&theme=starter&version=1.2.0', (page) =>
        page.clock.install()
      )
      await page.getByRole('button', { name: `Activate on ${siteName}` }).click()
      await page.getByText(/^Saved\. Waiting for the frontend to switch to starter/).waitFor()
      const link = page.getByRole('link', { name: /^Open the site/ })
      await expect(link.getAttribute('href')).resolves.toBe(site.origin)
      expect((await defaultSite()).theme?.themeId).toBe('starter')
      // Three minutes pass with no answer that names starter.
      await page.clock.fastForward('03:01')
      await page
        .getByText(
          'The frontend has not applied the pin of starter yet: it reads a new pin only when it renders a page of the site. Open the site, then reload this page.'
        )
        .waitFor()
      await expect(
        page.getByRole('link', { name: /^Open the site/ }).getAttribute('href')
      ).resolves.toBe(site.origin)
      await expect(page.getByText(/^Saved\. Waiting/).count()).resolves.toBe(0)
    } finally {
      site.themes.behaviour.readPin = readPin
      await setPin({ themeId: 'bogota' })
    }
  })

  it('shows the rebuild notice and no Activate button for a code theme the frontend was not built with', async () => {
    const page = await open('themes')
    await page.getByRole('tab', { name: 'Available in the registry (3)' }).click()
    const mosaico = card(page, 'mosaico')
    await mosaico.getByText('Needs an image built with it', { exact: true }).waitFor()
    await expect(
      mosaico
        .getByText(
          'You can preview it once a store of the frontend holds it. Activating it on this deployment needs an image built with it (ADR-0009); the operator is told how.'
        )
        .count()
    ).resolves.toBe(1)
    await expect(mosaico.getByRole('button', { name: /Activate/ }).count()).resolves.toBe(0)
    // The theme preview has no Activate button for it either.
    await mosaico.getByRole('link', { name: `Preview on ${siteName}: mosaico 0.9.0` }).click()
    await page
      .getByRole('heading', { level: 1, name: `Preview mosaico 0.9.0 on ${siteName}` })
      .waitFor()
    await page.getByText('Needs a rebuild', { exact: true }).waitFor()
    await expect(page.getByRole('button', { name: /^Activate/ }).count()).resolves.toBe(0)
    // The page wrote nothing: test/strapi/themes.test.ts covers the server's refusal.
    expect((await defaultSite()).theme?.themeId).toBe('bogota')
  })

  it('has no axe violation on the Themes page and the theme preview', async () => {
    const page = await open('themes')
    for (const name of ['Installed (2)', 'Available in the registry (3)', 'Updates (1)']) {
      await page.getByRole('tab', { name }).click()
      await page.getByRole('tab', { name, selected: true }).waitFor()
      await expect(violationsOf(page)).resolves.toEqual([])
    }
    await page.getByRole('tab', { name: 'Installed (2)' }).click()
    await page.getByRole('button', { name: 'Admission report: bogota 1.0.0' }).click()
    await page.getByRole('alertdialog').waitFor()
    await settled(page)
    await expect(violationsOf(page, '[role="alertdialog"]')).resolves.toEqual([])
    await page.getByRole('button', { name: 'Close' }).click()
    await page.goto(
      `${base}/admin/plugins/micelio/themes/preview?site=default&theme=starter&version=1.2.0`
    )
    const candidate = page.frameLocator(
      'section[aria-label="Candidate · starter 1.2.0"] iframe >> nth=-1'
    )
    await eventually(() => candidate.locator('html').getAttribute('data-theme')).toBe('starter')
    await expect(violationsOf(page)).resolves.toEqual([])
  })

  it('shows the site picker beside the title and the active theme in bold in the subtitle, and no Refresh registry', async () => {
    const page = await open('themes')
    const title = page.getByRole('heading', { level: 1, name: 'Themes' })
    const picker = page.getByLabel('Site', { exact: true })
    await picker.waitFor()
    const [titleBox, pickerBox] = await Promise.all([title.boundingBox(), picker.boundingBox()])
    // On the title's row, to its right: not under it.
    expect(pickerBox!.x).toBeGreaterThan(titleBox!.x + titleBox!.width)
    expect(pickerBox!.y).toBeLessThan(titleBox!.y + titleBox!.height)
    expect(pickerBox!.y + pickerBox!.height).toBeGreaterThan(titleBox!.y)
    await expect(picker.locator('option').allTextContents()).resolves.toEqual([siteName])
    const subtitle = page.locator('p', { hasText: `${siteName} runs` })
    await expect(subtitle.textContent()).resolves.toBe(
      `${siteName} runs bogota 1.0.0. Preview any theme on your own pages before activating it.`
    )
    await expect(subtitle.locator('strong').textContent()).resolves.toBe('bogota 1.0.0')
    await expect(
      subtitle
        .locator('strong')
        .evaluate((node) =>
          Number(node.ownerDocument.defaultView!.getComputedStyle(node).fontWeight)
        )
    ).resolves.toBeGreaterThanOrEqual(600)
    await expect(page.getByRole('button', { name: /Refresh/ }).count()).resolves.toBe(0)
  })

  it('lists the themes in three tabs, Installed, Available in the registry and Updates, each with its count', async () => {
    const page = await open('themes')
    const tabs = page.getByRole('tablist').getByRole('tab')
    await page.getByRole('tab', { name: 'Installed (2)' }).waitFor()
    await expect(tabs.allTextContents()).resolves.toEqual([
      'Installed (2)',
      'Available in the registry (3)',
      'Updates (1)',
    ])
    await expect(tabs.evaluateAll((all) => all.map((tab) => tab.ariaSelected))).resolves.toEqual([
      'true',
      'false',
      'false',
    ])
    // Tabs, not the sections of #59.
    await expect(page.getByRole('heading', { level: 2, name: /^Installed/ }).count()).resolves.toBe(
      0
    )
    const titles = () => page.getByRole('tabpanel').getByRole('heading', { level: 3 })
    await expect(titles().allTextContents()).resolves.toEqual(['Bogotá', 'Starter'])
    await page.getByRole('tab', { name: 'Available in the registry (3)' }).click()
    await expect(titles().allTextContents()).resolves.toEqual(['Starter', 'sendero', 'mosaico'])
    await page.getByRole('tab', { name: 'Updates (1)' }).click()
    await expect(titles().allTextContents()).resolves.toEqual(['Starter 1.3.0'])
  })

  it('lays the cards out in two equal columns at 1280 px', async () => {
    const page = await open('themes')
    await page.setViewportSize({ width: 1280, height: 980 })
    await card(page, 'starter').waitFor()
    const [first, second] = await Promise.all([
      card(page, 'bogota').boundingBox(),
      card(page, 'starter').boundingBox(),
    ])
    expect(Math.abs(first!.width - second!.width)).toBeLessThan(1)
    expect(Math.abs(first!.y - second!.y)).toBeLessThan(1)
    // A 16 px gap between the columns.
    expect(second!.x - (first!.x + first!.width)).toBeCloseTo(16, 0)
    await page.getByRole('tab', { name: 'Available in the registry (3)' }).click()
    const registry = await page
      .getByRole('tabpanel')
      .locator('article')
      .evaluateAll((all) =>
        all.map((node) => {
          const { x, y, width } = node.getBoundingClientRect()
          return { x: Math.round(x), y: Math.round(y), width: Math.round(width) }
        })
      )
    // Three cards: two on the first row, the third under the first.
    expect(registry[0]!.y).toBe(registry[1]!.y)
    expect(registry[2]!.x).toBe(registry[0]!.x)
    expect(registry[2]!.y).toBeGreaterThan(registry[0]!.y)
    expect(new Set(registry.map(({ width }) => width)).size).toBe(1)
  })

  it('marks the active card with a 2 px border and an Active badge with a dot in the success colours', async () => {
    const page = await open('themes')
    const bogota = card(page, 'bogota')
    await bogota.waitFor()
    const styleOf = (target: Locator) =>
      target.evaluate((node) => {
        const style = node.ownerDocument.defaultView!.getComputedStyle(node)
        return {
          borderWidth: style.borderTopWidth,
          borderStyle: style.borderTopStyle,
          borderColor: style.borderTopColor,
          background: style.backgroundColor,
          color: style.color,
          width: style.width,
          height: style.height,
        }
      })
    // success600, success100 and success700 of the Design System's light theme.
    await expect(styleOf(bogota)).resolves.toMatchObject({
      borderWidth: '2px',
      borderStyle: 'solid',
      borderColor: 'rgb(50, 128, 72)',
    })
    await expect(styleOf(card(page, 'starter'))).resolves.toMatchObject({
      borderWidth: '2px',
      borderColor: 'rgba(0, 0, 0, 0)',
    })
    const badge = bogota.locator('[data-badge="active"]')
    await expect(badge.textContent()).resolves.toBe('Active')
    await expect(styleOf(badge)).resolves.toMatchObject({
      background: 'rgb(234, 251, 231)',
      color: 'rgb(47, 104, 70)',
    })
    await expect(styleOf(badge.locator('span'))).resolves.toMatchObject({
      width: '6px',
      height: '6px',
      background: 'rgb(50, 128, 72)',
    })
    await expect(card(page, 'starter').locator('[data-badge="active"]').count()).resolves.toBe(0)
  })

  it('shows on an installed card its name, the meta line, its modes, its five variants and its admission, accessibility and rebuild chips', async () => {
    const page = await open('themes')
    const bogota = card(page, 'bogota')
    await bogota.waitFor()
    await expect(bogota.getByRole('heading', { level: 3 }).textContent()).resolves.toBe('Bogotá')
    await expect(
      bogota.getByText('bogota 1.0.0 · contract 2.3 · code theme', { exact: true }).count()
    ).resolves.toBe(1)
    // A code theme the image is built with needs no rebuild chip.
    await expect(chipsOf(bogota)).resolves.toEqual([
      'claro · oscuro',
      'bar · showcase · list · aside · minimal',
      'Admitted · AA · budgets pass',
      'Manual a11y check 2026-10-18',
    ])
    const starter = card(page, 'starter')
    await expect(starter.getByRole('heading', { level: 3 }).textContent()).resolves.toBe('Starter')
    await expect(
      starter.getByText('starter 1.2.0 · contract 2.3 · data-only', { exact: true }).count()
    ).resolves.toBe(1)
    await expect(chipsOf(starter)).resolves.toEqual([
      'light · dark',
      'centered · index · list · centered · minimal',
      'Admitted · AA · budgets pass',
      'Activates without a rebuild',
    ])
    const colours = (chip: string) =>
      starter.locator(`[data-chip="${chip}"]`).evaluate((node) => {
        const style = node.ownerDocument.defaultView!.getComputedStyle(node)
        return [style.backgroundColor, style.color, style.fontSize]
      })
    // success100 and success700, secondary100 and secondary700, neutral100 and neutral800; 11 px.
    await expect(colours('admission')).resolves.toEqual([
      'rgb(234, 251, 231)',
      'rgb(47, 104, 70)',
      '11px',
    ])
    await expect(colours('rebuild')).resolves.toEqual([
      'rgb(234, 245, 255)',
      'rgb(0, 96, 150)',
      '11px',
    ])
    await expect(colours('modes')).resolves.toEqual([
      'rgb(246, 246, 249)',
      'rgb(50, 50, 77)',
      '11px',
    ])
  })

  it("shows the id and the short form when the frontend's catalogue has no name, modes, layout or checks", async () => {
    const { catalogue } = site.themes.behaviour
    const { installed, reports } = catalogue
    // A frontend that predates bogd3v/micelio#1018.
    catalogue.installed = installed.map(
      ({ name: _name, modes: _modes, layout: _layout, ...rest }) => rest
    )
    catalogue.reports = reports.map(
      ({ checks: _checks, accessibility: _accessibility, ...rest }) => rest
    )
    try {
      const page = await open('themes')
      const bogota = card(page, 'bogota')
      await bogota.waitFor()
      await expect(bogota.getByRole('heading', { level: 3 }).textContent()).resolves.toBe('bogota')
      await expect(
        bogota.getByText('bogota 1.0.0 · contract 2.3 · code theme', { exact: true }).count()
      ).resolves.toBe(1)
      await expect(chipsOf(bogota)).resolves.toEqual(['Admitted'])
      const starter = card(page, 'starter')
      await expect(starter.getByRole('heading', { level: 3 }).textContent()).resolves.toBe(
        'starter'
      )
      await expect(chipsOf(starter)).resolves.toEqual(['Admitted', 'Activates without a rebuild'])
      await page.getByRole('tab', { name: 'Updates (1)' }).click()
      await expect(
        page.getByRole('tabpanel').getByRole('heading', { level: 3 }).textContent()
      ).resolves.toBe('starter 1.3.0')
    } finally {
      catalogue.installed = installed
      catalogue.reports = reports
    }
  })

  it('opens the admission report in a dialog', async () => {
    const page = await open('themes')
    // A summary, not a disclosure on the card.
    await card(page, 'bogota').waitFor()
    await expect(page.locator('article details').count()).resolves.toBe(0)
    await expect(
      card(page, 'bogota').getByText('bogota 1.0.0: AA contrast, axe clean, budgets pass.').count()
    ).resolves.toBe(0)
    await card(page, 'bogota')
      .getByRole('button', { name: 'Admission report: bogota 1.0.0' })
      .click()
    const dialog = page.getByRole('alertdialog', { name: 'Admission report · bogota 1.0.0' })
    await dialog.waitFor()
    await expect(
      dialog.getByText('bogota 1.0.0: AA contrast, axe clean, budgets pass.').count()
    ).resolves.toBe(1)
    await dialog.getByRole('button', { name: 'Close' }).click()
    await dialog.waitFor({ state: 'hidden' })
    await card(page, 'starter')
      .getByRole('button', { name: 'Admission report: starter 1.2.0' })
      .click()
    await page
      .getByRole('alertdialog', { name: 'Admission report · starter 1.2.0' })
      .getByText('starter 1.2.0: AA contrast, axe clean, budgets pass.')
      .waitFor()
  })

  it('links the active card to the Customize page of the site, and offers Preview and no Activate on the other installed cards', async () => {
    const page = await open('themes')
    const bogota = card(page, 'bogota')
    await bogota.waitFor()
    await expect(namesOf(bogota)).resolves.toEqual(['Customize', 'Admission report: bogota 1.0.0'])
    await expect(namesOf(card(page, 'starter'))).resolves.toEqual([
      `Preview on ${siteName}: starter 1.2.0`,
      'Admission report: starter 1.2.0',
    ])
    // The installed card's Preview is the primary button.
    await expect(
      card(page, 'starter')
        .getByRole('link', { name: /^Preview/ })
        .evaluate((node) => node.ownerDocument.defaultView!.getComputedStyle(node).backgroundColor)
    ).resolves.toBe('rgb(73, 69, 255)')
    await expect(page.getByRole('button', { name: /Activate/ }).count()).resolves.toBe(0)
    await expect(
      bogota.getByRole('link', { name: 'Customize' }).getAttribute('href')
    ).resolves.toBe('/admin/plugins/micelio/customize?site=default')
    await bogota.getByRole('link', { name: 'Customize' }).click()
    await page.waitForURL(/\/admin\/plugins\/micelio\/customize\?site=default$/)
    await page.getByRole('heading', { level: 1, name: 'Customize' }).waitFor()
  })

  it('shows a registry card with its tier badge, licence and rebuild chip, the note on a code theme, and no Install', async () => {
    const { registry } = site.themes.behaviour.catalogue
    const sendero = registry!.find(({ id }) => id === 'sendero')!.versions[0]!
    // A version the registry says does not run on this core.
    sendero.runs = false
    try {
      const page = await open('themes')
      await page.getByRole('tab', { name: 'Available in the registry (3)' }).click()
      const mosaico = card(page, 'mosaico')
      await expect(mosaico.getByRole('heading', { level: 3 }).textContent()).resolves.toBe(
        'mosaico'
      )
      await expect(
        mosaico
          .getByText('mosaico 0.9.0 · contract 2.3 · code theme · MIT', { exact: true })
          .count()
      ).resolves.toBe(1)
      const badge = mosaico.getByText('Registry · community', { exact: true })
      // alternative100 and alternative700.
      await expect(
        badge.evaluate((node) => [
          node.ownerDocument.defaultView!.getComputedStyle(node).backgroundColor,
          node.ownerDocument.defaultView!.getComputedStyle(node).color,
        ])
      ).resolves.toEqual(['rgb(246, 236, 252)', 'rgb(131, 18, 209)'])
      await expect(chipsOf(mosaico)).resolves.toEqual([
        'Refused at admission',
        'Needs an image built with it',
      ])
      await expect(
        mosaico
          .locator('[data-chip="rebuild"]')
          .evaluate((node) => [
            node.ownerDocument.defaultView!.getComputedStyle(node).backgroundColor,
            node.ownerDocument.defaultView!.getComputedStyle(node).color,
          ])
      ).resolves.toEqual(['rgb(253, 244, 220)', 'rgb(50, 50, 77)'])
      await expect(
        mosaico
          .getByText(
            'You can preview it once a store of the frontend holds it. Activating it on this deployment needs an image built with it (ADR-0009); the operator is told how.',
            { exact: true }
          )
          .count()
      ).resolves.toBe(1)
      await expect(namesOf(mosaico)).resolves.toEqual([`Preview on ${siteName}: mosaico 0.9.0`])
      const data = card(page, 'sendero')
      await expect(chipsOf(data)).resolves.toEqual([
        'Admitted · AA · budgets pass',
        'Activates without a rebuild',
        'Does not run on this core',
      ])
      // The note is for a code theme only.
      await expect(data.locator('p').count()).resolves.toBe(0)
      await expect(page.getByRole('button', { name: /Install/ }).count()).resolves.toBe(0)
      await expect(page.getByRole('link', { name: /Install/ }).count()).resolves.toBe(0)

      // A code theme the image is built with needs neither the note nor the chip.
      site.themes.behaviour.builtIn.push({ id: 'mosaico', version: '0.9.0', code: true })
      await page.reload()
      await page.getByRole('tab', { name: 'Available in the registry (3)' }).click()
      await expect(chipsOf(card(page, 'mosaico'))).resolves.toEqual(['Refused at admission'])
      await expect(card(page, 'mosaico').locator('p').count()).resolves.toBe(0)
    } finally {
      sendero.runs = true
      const { builtIn } = site.themes.behaviour
      if (builtIn.at(-1)?.id === 'mosaico') builtIn.pop()
    }
  })

  it('shows an update card with its versions, the kind of change and Preview the update, and no Changelog', async () => {
    const page = await open('themes')
    await page.getByRole('tab', { name: 'Updates (1)' }).click()
    const update = page.getByRole('tabpanel').locator('article[data-theme-card="starter"]')
    await expect(update.getByRole('heading', { level: 3 }).textContent()).resolves.toBe(
      'Starter 1.3.0'
    )
    await expect(
      update.getByText('from 1.2.0 · minor · contract 2.3', { exact: true }).count()
    ).resolves.toBe(1)
    const badge = update.getByText('Update', { exact: true })
    // secondary100 and secondary700.
    await expect(
      badge.evaluate((node) => [
        node.ownerDocument.defaultView!.getComputedStyle(node).backgroundColor,
        node.ownerDocument.defaultView!.getComputedStyle(node).color,
      ])
    ).resolves.toEqual(['rgb(234, 245, 255)', 'rgb(0, 96, 150)'])
    await expect(
      update
        .getByText(
          'Preview compares 1.2.0 and 1.3.0 on your pages. A minor keeps your overrides; a major may ask you to re-check them.',
          { exact: true }
        )
        .count()
    ).resolves.toBe(1)
    await expect(namesOf(update)).resolves.toEqual(['Preview the update: starter 1.3.0'])
    const link = update.getByRole('link', { name: 'Preview the update: starter 1.3.0' })
    await expect(link.textContent()).resolves.toBe('Preview the update')
    await expect(link.getAttribute('href')).resolves.toBe(
      '/admin/plugins/micelio/themes/preview?site=default&theme=starter&version=1.3.0'
    )
    await expect(page.getByRole('button', { name: /Changelog/ }).count()).resolves.toBe(0)
    await expect(page.getByRole('link', { name: /Changelog/ }).count()).resolves.toBe(0)
  })

  it('says on the registry tab that the frontend reads the registry once an hour, and shows the footnote on variants', async () => {
    const page = await open('themes')
    const footnote = page.getByText(
      'The five names on a card are the variant the theme picked for header, home, post list, article and footer; a site cannot change them.',
      { exact: true }
    )
    await footnote.waitFor()
    await expect(
      page.getByText('The frontend reads the registry once an hour.').count()
    ).resolves.toBe(0)
    // Under the grid.
    const [lastCard, note] = await Promise.all([
      card(page, 'starter').boundingBox(),
      footnote.boundingBox(),
    ])
    expect(note!.y).toBeGreaterThan(lastCard!.y + lastCard!.height)
    await page.getByRole('tab', { name: 'Available in the registry (3)' }).click()
    const hourly = page.getByText('The frontend reads the registry once an hour.', { exact: true })
    await hourly.waitFor()
    const [hourlyBox, firstCard] = await Promise.all([
      hourly.boundingBox(),
      page.getByRole('tabpanel').locator('article').first().boundingBox(),
    ])
    expect(hourlyBox!.y + hourlyBox!.height).toBeLessThanOrEqual(firstCard!.y)
    await footnote.waitFor()
  })

  it('saves a screenshot of each tab and the report dialog at 1280 × 980 when MICELIO_SCREENSHOTS is set', async ({
    skip,
  }) => {
    // Skipped without the variable: the screenshots are for the maintainer, not for CI.
    if (!process.env.MICELIO_SCREENSHOTS) skip()
    const folder = process.env.MICELIO_SCREENSHOTS ?? ''
    mkdirSync(folder, { recursive: true })
    const page = await open('themes')
    await page.setViewportSize({ width: 1280, height: 980 })
    const shots: [string, string][] = [
      ['themes-installed.png', 'Installed (2)'],
      ['themes-registry.png', 'Available in the registry (3)'],
      ['themes-updates.png', 'Updates (1)'],
    ]
    for (const [file, tab] of shots) {
      await page.getByRole('tab', { name: tab }).click()
      await page.getByRole('tabpanel').locator('article').first().waitFor()
      await page.screenshot({ path: join(folder, file) })
    }
    await page.getByRole('tab', { name: 'Installed (2)' }).click()
    await page.getByRole('button', { name: 'Admission report: bogota 1.0.0' }).click()
    await page.getByRole('alertdialog').waitFor()
    await settled(page)
    await page.screenshot({ path: join(folder, 'themes-report.png') })
    for (const file of [...shots.map(([name]) => name), 'themes-report.png']) {
      // The width and height of a PNG are the first two fields of its IHDR chunk.
      const png = readFileSync(join(folder, file))
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 980])
    }
  })
})
