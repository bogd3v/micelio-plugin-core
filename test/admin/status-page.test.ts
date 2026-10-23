import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type Page } from 'playwright'
import { BLOCKS } from '../../contract/blocks'
import en from '../../admin/src/translations/en.json'
import es from '../../admin/src/translations/es.json'
import packageJson from '../../package.json'
import { SITE_UID } from '../../server/src/constants/site'
import { closedOrigin, startFrontend, type FrontendStub } from '../strapi/frontend'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'

const EMAIL = 'admin@example.com'
// A second super admin whose interface language is Spanish: Strapi 5.59 switches the admin to the
// user's `preferedLanguage` once they log in (`features/Auth` of `@strapi/admin`).
const SPANISH_EMAIL = 'admin-es@example.com'
const PASSWORD = 'Password1234'

// What the standard requires of the admin page: WCAG 2.0, 2.1 and 2.2, levels A and AA (section 9).
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

type Messages = Record<string, string>

/** Opens the status page in a context of its own, logged in as one admin user. */
async function openStatusPage(browser: Browser, base: string, email: string): Promise<Page> {
  // A context of its own: axe injects its script into every frame of it.
  const page = await (await browser.newContext()).newPage()
  await page.goto(`${base}/admin/auth/login`)
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(/\/admin(?!\/auth)/)
  await page.goto(`${base}/admin/plugins/micelio`)
  return page
}

/**
 * The text of the page's `main`, one line per text node, as written in the source: `textContent`
 * alone runs the cells together ("ResultadoWhat it found"), and `innerText` applies
 * `text-transform`.
 */
async function textOf(page: Page): Promise<string> {
  return page.getByRole('main').evaluate((main) => {
    // 4 is `NodeFilter.SHOW_TEXT`; this file is type-checked without the DOM globals.
    const walker = main.ownerDocument.createTreeWalker(main, 4)
    const lines: string[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      lines.push(node.textContent ?? '')
    }
    return lines.join('\n')
  })
}

/** Matches `text` with no letter right before or after it. */
function wholeWords(text: string): RegExp {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, 'u')
}

/** The WCAG 2.2 A and AA violations axe finds in the page's `main`. */
async function violationsOf(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
  return results.violations.flatMap(({ id, nodes }) =>
    nodes.map(({ target, failureSummary }) => ({ id, target, failureSummary }))
  )
}

describe('the status page in the admin', () => {
  let strapi: Core.Strapi
  let base: string
  let frontend: FrontendStub
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    // The blog's frontend is down when the check runs and up when the page loads, as at a boot.
    const blogOrigin = await closedOrigin()
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    for (const [slug, url] of [
      ['blog', blogOrigin],
      ['docs', await closedOrigin()],
    ]) {
      await sites.create({
        data: {
          name: `The ${slug}`,
          slug,
          hosts: [`${slug}.example.com`],
          isDefault: false,
          defaultLocale: 'en',
          modules: {},
          url,
        },
      })
    }
    // Again, now that the sites have a frontend: the boot's run saw none.
    await strapi.plugin('micelio').service('hostCheck').run()
    frontend = await startFrontend('0.6.3', Number(new URL(blogOrigin).port))
    const superAdmin = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    for (const [email, preferedLanguage] of [
      [EMAIL, null],
      [SPANISH_EMAIL, 'es'],
    ]) {
      await strapi.service('admin::user').create({
        email,
        firstname: 'Admin',
        lastname: 'Test',
        password: PASSWORD,
        roles: [superAdmin.id],
        isActive: true,
        preferedLanguage,
      })
    }

    browser = await chromium.launch()
    page = await openStatusPage(browser, base, EMAIL)
    await page.getByRole('heading', { name: 'Host check' }).waitFor()
  })

  afterAll(async () => {
    await browser?.close()
    await frontend?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
  })

  it('shows the plugin, the host check, the frontends and the sites', async () => {
    const main = page.getByRole('main')
    await expect(main.getByRole('heading', { level: 1, name: 'Micelio' }).count()).resolves.toBe(1)
    // `textContent`, not `innerText`: labels are upper case on screen only (`text-transform`).
    const text = (await main.textContent()) ?? ''
    expect(text).toContain(packageJson.version)
    expect(text).toContain(packageJson.micelio)
    expect(text).toContain(`Blocks in the catalogue${BLOCKS.length}`)
    // Host check results, translated by their id.
    expect(text).toContain('Every required check passes.')
    expect(text).toContain('Sanitiser for HTML from content')
    expect(text).toContain('Frontend release line')
    // One frontend answers its health endpoint, the other is not available, not an error.
    expect(text).toContain(frontend.origin)
    expect(text).toContain('0.6.3')
    expect(text).toContain('Not available')
    // The sites and their host names.
    expect(text).toContain('blog.example.com')
    expect(text).toContain('docs.example.com')
  })

  it('runs the host check again and shows the new report without a reload', async () => {
    const releaseLine = page.getByRole('row').filter({ hasText: 'Frontend release line' })
    await expect(releaseLine.textContent()).resolves.toContain(
      `${frontend.origin} is not reachable`
    )
    await page.getByRole('button', { name: 'Run again' }).click()
    await releaseLine.getByText(`${frontend.origin} runs 0.6.3`).waitFor()
    await page.getByRole('button', { name: 'Run again' }).waitFor()
    // The verdict is announced, since the table changes where the focus is not.
    await expect(page.getByRole('status').allTextContents()).resolves.toContainEqual(
      expect.stringContaining('Every required check passes.')
    )
  })

  // After the run: the button and the replaced report are checked too.
  it('has no WCAG 2.2 A or AA violation', async () => {
    await expect(violationsOf(page)).resolves.toEqual([])
  })

  describe('in Spanish', () => {
    let spanish: Page
    let text: string

    beforeAll(async () => {
      spanish = await openStatusPage(browser, base, SPANISH_EMAIL)
      await spanish.getByRole('heading', { name: 'Comprobación del host' }).waitFor()
      text = await textOf(spanish)
    })

    it('shows the Spanish strings, with the title of every host check', () => {
      expect(text).toContain('Comprobación del host')
      expect(text).toContain('No disponible')
      const titles = Object.entries(es as Messages).filter(([id]) =>
        /^status\.hostCheck\.check\.[a-z-]+\.title$/.test(id)
      )
      expect(titles).toHaveLength(8)
      for (const [id, title] of titles) expect(text, id).toContain(title)
    })

    it('shows each result of the host check in Spanish', async () => {
      // `textContent`: the badges are upper case on screen only (`text-transform`).
      const resultOf = (title: string) =>
        spanish.getByRole('row').filter({ hasText: title }).textContent()
      await expect(resultOf('Versión de Node')).resolves.toContain('Pasa')
      // SQLite outside production: skipped. The stub frontends are not in frame-src: failed.
      await expect(resultOf('PostgreSQL en producción')).resolves.toContain('Omitida')
      await expect(resultOf('frame-src para la vista previa')).resolves.toContain('Falla')
    })

    it('shows no English string that has a Spanish one', () => {
      const englishOnly = Object.entries(en as Messages).filter(
        ([id, value]) => (es as Messages)[id] !== value
      )
      // A placeholder is filled in on screen: look for the text around it, as whole words, so
      // that "Result" is not found in "Resultado".
      const shown = englishOnly.filter(([, value]) =>
        value
          .split(/\{\w+\}/)
          .map((part) => part.trim())
          .some((part) => part.length > 3 && wholeWords(part).test(text))
      )
      expect(shown.map(([id]) => id)).toEqual([])
    })

    it('has no WCAG 2.2 A or AA violation', async () => {
      await expect(violationsOf(spanish)).resolves.toEqual([])
    })
  })
})
