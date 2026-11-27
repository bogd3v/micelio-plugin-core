import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
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

  async function violationsOf(page: Page): Promise<unknown[]> {
    const results = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
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
    await page.getByRole('heading', { level: 2, name: 'Installed (2)' }).waitFor()
    await page.getByText(`The theme of ${siteName} is bogota 1.0.0.`, { exact: false }).waitFor()
    const bogota = card(page, 'bogota').first()
    await expect(bogota.getByRole('heading', { level: 3 }).textContent()).resolves.toBe(
      'bogota 1.0.0'
    )
    await expect(bogota.getByText('Active', { exact: true }).count()).resolves.toBe(1)
    await expect(
      bogota.getByText('contract 2.3 · code theme · built into the image').count()
    ).resolves.toBe(1)
    await expect(bogota.getByText('Admitted · The image is built with it').count()).resolves.toBe(1)
    await expect(
      bogota.getByText('bogota 1.0.0: AA contrast, axe clean, budgets pass.').count()
    ).resolves.toBe(1)
    // The active theme offers neither a preview nor an activation.
    await expect(bogota.getByRole('button').count()).resolves.toBe(0)
    const starter = card(page, 'starter').first()
    await expect(starter.getByText('Installed', { exact: true }).count()).resolves.toBe(1)
    await expect(starter.getByText('Active', { exact: true }).count()).resolves.toBe(0)
    await expect(starter.getByText('Admitted · Activates without a rebuild').count()).resolves.toBe(
      1
    )
    await expect(
      starter.getByRole('button', { name: `Activate starter 1.2.0 on ${siteName}` }).count()
    ).resolves.toBe(1)
    await expect(
      starter.getByRole('link', { name: `Preview on ${siteName}: starter 1.2.0` }).count()
    ).resolves.toBe(1)
    // The admin never called the frontend: every request of the page went to the CMS.
    const calls: string[] = []
    page.on('request', (request) => calls.push(request.url()))
    await page.reload()
    await page.getByRole('heading', { level: 2, name: 'Installed (2)' }).waitFor()
    expect(calls.filter((url) => url.startsWith(site.origin))).toEqual([])
  })

  it("lists the registry's themes with their admission report result, and the updates of the installed ones", async () => {
    const page = await open('themes')
    const registry = page.locator('section', {
      has: page.getByRole('heading', { level: 2, name: 'Available in the registry (3)' }),
    })
    await registry.waitFor()
    const titles = await registry.getByRole('heading', { level: 3 }).allTextContents()
    expect(titles).toEqual(['starter 1.3.0', 'sendero 2.1.0', 'mosaico 0.9.0'])
    const sendero = registry.locator('article[data-theme-card="sendero"]')
    await expect(sendero.getByText('Registry · official').count()).resolves.toBe(1)
    await expect(
      sendero.getByText('contract 2.3 · data-only · MIT · runs on this core').count()
    ).resolves.toBe(1)
    await expect(sendero.getByText('Admitted · Activates without a rebuild').count()).resolves.toBe(
      1
    )
    const mosaico = registry.locator('article[data-theme-card="mosaico"]')
    await expect(mosaico.getByText('Registry · community').count()).resolves.toBe(1)
    await expect(
      mosaico.getByText('Refused at admission · Needs an image built with it').count()
    ).resolves.toBe(1)

    const updates = page.locator('section', {
      has: page.getByRole('heading', { level: 2, name: 'Updates (1)' }),
    })
    const update = updates.locator('article[data-theme-card="starter"]')
    await expect(update.getByRole('heading', { level: 3 }).textContent()).resolves.toBe(
      'starter 1.3.0'
    )
    await expect(update.getByText('Update from 1.2.0').count()).resolves.toBe(1)
    await expect(
      update.getByText('starter 1.3.0: AA contrast, axe clean, budgets pass.').count()
    ).resolves.toBe(1)

    // A registry the frontend could not read shows its reason.
    const { catalogue } = site.themes.behaviour
    const registryBefore = catalogue.registry
    catalogue.registry = null
    catalogue.reason = 'the index did not verify'
    try {
      await page.reload()
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
    await card(page, 'starter')
      .first()
      .getByRole('button', { name: `Activate starter 1.2.0 on ${siteName}` })
      .click()
    await page.getByText('The frontend now renders starter.', { exact: true }).waitFor()
    expect((await defaultSite()).theme).toMatchObject({
      themeId: 'starter',
      themeVersion: null,
      themeDigest: null,
    })
    await expect(
      card(page, 'starter').first().getByText('Active', { exact: true }).count()
    ).resolves.toBe(1)
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
      const page = await open('themes', (page) => page.clock.install())
      await card(page, 'starter')
        .first()
        .getByRole('button', { name: `Activate starter 1.2.0 on ${siteName}` })
        .click()
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
    const mosaico = card(page, 'mosaico')
    await mosaico.getByText('Needs a rebuild', { exact: true }).waitFor()
    await expect(
      mosaico
        .getByText(
          "mosaico 0.9.0 ships code, which runs only on an image built with it. It cannot be activated on this frontend: the operator rebuilds the frontend's image with it first."
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
    await page.getByRole('heading', { level: 2, name: 'Installed (2)' }).waitFor()
    await expect(violationsOf(page)).resolves.toEqual([])
    await page.goto(
      `${base}/admin/plugins/micelio/themes/preview?site=default&theme=starter&version=1.2.0`
    )
    const candidate = page.frameLocator(
      'section[aria-label="Candidate · starter 1.2.0"] iframe >> nth=-1'
    )
    await eventually(() => candidate.locator('html').getAttribute('data-theme')).toBe('starter')
    await expect(violationsOf(page)).resolves.toEqual([])
  })
})
