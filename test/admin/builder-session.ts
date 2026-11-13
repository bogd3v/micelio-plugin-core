// The browser suites of the builder's keyboard (issue #50) share one boot: a clean Strapi with its
// admin, the stub frontend, and a way to open a page as a new admin in a browser of its own.

import { afterAll, afterEach, beforeAll, expect } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'
import { startPreviewSite, type PreviewSite } from '../strapi/preview-site'

/** An editorial page made of sections, measured at publish. */
export const LANDING_UID = 'api::landing.landing'
/** The same, with page settings: it has the gear and the drawer. */
export const BROCHURE_UID = 'api::brochure.brochure'
/** A page with a field `micelio.icon` of its own, in a component and in a block of its zone. */
export const EMBLEM_UID = 'api::emblem.emblem'
const PASSWORD = 'Password1234'
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

/** `expect.poll` with the time a save, a frame reload and its report take. */
export const eventually = <T>(read: () => Promise<T> | T) => expect.poll(read, { timeout: 20_000 })

export interface BuilderSession {
  readonly base: string
  readonly strapi: Core.Strapi
  /** The stub frontend. */
  readonly site: PreviewSite
  /** Creates a page of `uid` with these sections and gives its document id; `extra` adds to its data. */
  seed: (
    uid: string,
    sections: object[],
    title?: string,
    extra?: Record<string, unknown>
  ) => Promise<string>
  /** Opens the builder on a page as a new admin, with the options of its browser. */
  open: (uid: string, documentId: string, options?: OpenOptions) => Promise<Page>
}

export interface OpenOptions {
  theme?: 'dark'
  /** The `navigator.platform` the page reads, for the symbols of the sheet. */
  platform?: string
  viewport?: { width: number; height: number }
  /** The interface language of the admin who opens the page: Strapi's `preferedLanguage`. */
  language?: 'es'
}

/**
 * Registers the hooks of a browser suite of the builder and gives its helpers. Call it inside
 * `describe`.
 */
export function useBuilderSession(): BuilderSession {
  let strapi: Core.Strapi
  let base = ''
  let site: PreviewSite
  let browser: Browser
  let siteDocumentId = ''
  let superAdminId = 0
  let admins = 0
  const contexts: BrowserContext[] = []

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    strapi.config.set('plugin::micelio.budgets', {
      ...strapi.config.get<Record<string, unknown>>('plugin::micelio.budgets'),
      contentTypes: [LANDING_UID, BROCHURE_UID],
    })
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    site = await startPreviewSite()
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    siteDocumentId = ((await sites.findFirst()) as { documentId: string }).documentId
    await sites.update({ documentId: siteDocumentId, data: { url: site.origin } as never })
    const apiToken = (await strapi.service('admin::api-token').create({
      name: 'keyboard-test',
      type: 'custom',
      lifespan: null,
      permissions: ['plugin::micelio.preview.exchange', 'plugin::micelio.preview.draft'],
    })) as { accessKey: string }
    site.connect({ base, apiToken: apiToken.accessKey, adminOrigin: base })
    superAdminId = (
      (await strapi.db.query('admin::role').findOne({
        where: { code: 'strapi-super-admin' },
      })) as { id: number }
    ).id
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

  return {
    get base() {
      return base
    },
    get strapi() {
      return strapi
    },
    get site() {
      return site
    },
    async seed(uid, sections, title = 'Keyboard page', extra = {}) {
      const created = await strapi.documents(uid as UID.ContentType).create({
        locale: 'en',
        data: { title, site: siteDocumentId, sections, ...extra } as never,
      })
      return created.documentId
    },
    async open(uid, documentId, options = {}) {
      admins += 1
      const email = `keys-${admins}@example.com`
      await strapi.service('admin::user').create({
        email,
        firstname: 'Admin',
        lastname: 'Keys',
        password: PASSWORD,
        roles: [superAdminId],
        isActive: true,
        ...(options.language ? { preferedLanguage: options.language } : {}),
      })
      const context = await browser.newContext({
        viewport: options.viewport ?? { width: 1280, height: 900 },
        bypassCSP: true,
      })
      contexts.push(context)
      if (options.theme) {
        await context.addInitScript(
          (theme) => localStorage.setItem('STRAPI_THEME', theme),
          options.theme
        )
      }
      if (options.platform) {
        await context.addInitScript(
          (platform) => Object.defineProperty(navigator, 'platform', { get: () => platform }),
          options.platform
        )
      }
      const page = await context.newPage()
      await page.goto(`${base}/admin/auth/login`)
      await page.locator('input[name="email"]').fill(email)
      await page.locator('input[name="password"]').fill(PASSWORD)
      await page.getByRole('button', { name: 'Login' }).click()
      await page.waitForURL(/\/admin(?!\/auth)/)
      await page.goto(`${base}/admin/plugins/micelio/builder/${uid}/${documentId}?locale=en`)
      await page.getByRole('region', { name: /Page blocks|Bloques de la página/ }).waitFor()
      return page
    },
  }
}

/** The block ids the frame shows, in order. */
export const shown = (page: Page) =>
  page
    .frameLocator('main iframe >> nth=-1')
    .locator('[data-myc-block]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-myc-block')))

/** The text of each row of the block list, in order. */
export const listed = (page: Page) =>
  page
    .getByRole('region', { name: /Page blocks/ })
    .locator('[data-block-key]')
    .allTextContents()

/** The name of the row that is selected in the list, or `undefined`. */
export async function selectedRow(page: Page): Promise<string | undefined> {
  const row = page.locator('[data-block-key][aria-current="true"]')
  return (await row.count()) > 0 ? ((await row.first().textContent()) ?? undefined) : undefined
}

/** Waits for the animations that end (a dialog's fade-in): axe reads the colours as they are. */
export const settled = (page: Page) =>
  // A string: the suites' tsconfig has no DOM types.
  page.evaluate(
    'Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))).then(() => undefined)'
  )

/** What axe finds in the page's main region and in an open dialog, as rule and target. */
export async function violationsOf(page: Page): Promise<unknown[]> {
  await settled(page)
  const dialogs = await page.locator('[role="dialog"]').count()
  const results = await new AxeBuilder({ page })
    .include(dialogs > 0 ? '[role="dialog"]' : 'main')
    .withTags(WCAG_TAGS)
    .analyze()
  return results.violations.flatMap(({ id, nodes }) => nodes.map(({ target }) => ({ id, target })))
}

/** The accessible text of the element that has focus, or its tag. */
export const focused = (page: Page): Promise<string> =>
  page.evaluate(
    'document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? document.activeElement?.tagName'
  ) as Promise<string>

/** Presses Tab until `isThere` holds of the element in focus; fails after `limit` presses. */
export async function tabTo(page: Page, isThere: string, limit = 60): Promise<void> {
  for (let press = 0; press < limit; press++) {
    if (await page.evaluate(`Boolean((${isThere})(document.activeElement))`)) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`Tab did not reach ${isThere} in ${limit} presses`)
}
