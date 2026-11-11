import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type Page } from 'playwright'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'

const EMAIL = 'admin@example.com'
// A second super admin whose interface language is Spanish (see test/admin/status-page.test.ts).
const SPANISH_EMAIL = 'admin-es@example.com'
// A third super admin for the layout tests: the admin login answers 5 attempts a minute per email.
const DESIGN_EMAIL = 'admin-design@example.com'
const PASSWORD = 'Password1234'

/** Opens the About page in a context of its own, logged in as one admin user. */
async function openAbout(browser: Browser, base: string, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto(`${base}/admin/auth/login`)
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(/\/admin(?!\/auth)/)
  await page.goto(`${base}/admin/plugins/micelio/about`)
  return page
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

/** The box of the card whose title is `title`. */
async function boxOf(page: Page, title: string) {
  const box = await page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) })
    .boundingBox()
  if (!box) throw new Error(`no card titled ${title}`)
  return box
}

/** The text of the row whose label is `label`: its `dd`. */
async function rowOf(page: Page, label: string): Promise<string> {
  const term = page.locator('dt', { hasText: label })
  return (await term.locator('xpath=following-sibling::dd[1]').textContent()) ?? ''
}

describe('the theme row of the About page', () => {
  let strapi: Core.Strapi
  let base: string
  let browser: Browser

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    process.env.MICELIO_UPDATE_CHECK = 'false'
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const superAdmin = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    for (const [email, preferedLanguage] of [
      [EMAIL, null],
      [SPANISH_EMAIL, 'es'],
      [DESIGN_EMAIL, null],
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
  })

  afterAll(async () => {
    await browser?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
    delete process.env.MICELIO_UPDATE_CHECK
  })

  it('shows the theme of the default site, in English and in Spanish', async () => {
    const page = await openAbout(browser, base, EMAIL)
    await page.getByRole('heading', { name: 'Versions and compatibility' }).waitFor()
    // The default site pins no theme yet.
    await expect(rowOf(page, 'Theme')).resolves.toBe('Not pinned')

    const sites = strapi.documents(SITE_UID as UID.ContentType)
    const [defaultSite] = await sites.findMany({ filters: { isDefault: true } })
    await sites.update({
      documentId: defaultSite.documentId,
      data: { theme: { themeId: 'bogota', themeVersion: '1.0.0' } } as never,
    })
    await page.reload()
    await page.getByRole('heading', { name: 'Versions and compatibility' }).waitFor()
    await expect(rowOf(page, 'Theme')).resolves.toBe('bogota 1.0.0')

    const spanish = await openAbout(browser, base, SPANISH_EMAIL)
    await spanish.getByRole('heading', { name: 'Versiones y compatibilidad' }).waitFor()
    await expect(rowOf(spanish, 'Tema')).resolves.toBe('bogota 1.0.0')

    // A pin without a version.
    await sites.update({
      documentId: defaultSite.documentId,
      data: { theme: { themeId: 'bogota', themeVersion: null } } as never,
    })
    await spanish.reload()
    await spanish.getByRole('heading', { name: 'Versiones y compatibilidad' }).waitFor()
    await expect(rowOf(spanish, 'Tema')).resolves.toBe('bogota (sin versión fijada)')
  })

  it('shows Versions beside Diagnostics and Where to go beside Licence and credits on a wide window, stacked on a narrow one', async () => {
    const page = await openAbout(browser, base, EMAIL)
    await page.getByRole('heading', { name: 'Versions and compatibility' }).waitFor()
    const pairs = [
      ['Versions and compatibility', 'Diagnostics'],
      ['Where to go', 'Licence and credits'],
    ] as const
    await page.setViewportSize({ width: 1600, height: 1000 })
    for (const [left, right] of pairs) {
      const [a, b] = [await boxOf(page, left), await boxOf(page, right)]
      expect(b.x, `${right} is to the right of ${left}`).toBeGreaterThan(a.x + a.width - 1)
      expect(Math.abs(b.y - a.y), `${left} and ${right} start on the same line`).toBeLessThan(2)
    }
    await page.setViewportSize({ width: 700, height: 1000 })
    for (const [first, second] of pairs) {
      const [a, b] = [await boxOf(page, first), await boxOf(page, second)]
      expect(b.y, `${second} is under ${first}`).toBeGreaterThan(a.y + a.height - 1)
      expect(Math.abs(b.x - a.x), `${first} and ${second} share a left edge`).toBeLessThan(2)
    }
    // Values are right-aligned and the package names are in monospace.
    await page.setViewportSize({ width: 1600, height: 1000 })
    const value = page
      .locator('dt', { hasText: 'Micelio Core plugin' })
      .locator('xpath=following-sibling::dd[1]')
    await expect(
      value.evaluate((element) => {
        const style = element.ownerDocument.defaultView!.getComputedStyle(element)
        return [style.textAlign, style.fontFamily]
      })
    ).resolves.toEqual(['right', 'monospace'])
  })

  it("starts the subtitle under the title's text, after the mark", async () => {
    const page = await openAbout(browser, base, DESIGN_EMAIL)
    await page.getByRole('heading', { name: 'Versions and compatibility' }).waitFor()
    for (const width of [1600, 700]) {
      await page.setViewportSize({ width, height: 1000 })
      const title = await page
        .getByRole('heading', { level: 1, name: 'About Micelio' })
        .boundingBox()
      const subtitle = await page.getByText('A site engine built on Strapi.').boundingBox()
      const mark = await page.locator('main svg').first().boundingBox()
      if (!title || !subtitle || !mark) throw new Error('the header is missing a part')
      expect(
        Math.abs(subtitle.x - title.x),
        `subtitle and title start together at ${width}`
      ).toBeLessThan(2)
      expect(title.x, `the title is after the mark at ${width}`).toBeGreaterThan(
        mark.x + mark.width - 1
      )
      expect(subtitle.y, `the subtitle is under the title at ${width}`).toBeGreaterThan(title.y)
    }
    // On a wide window (the Design System's buttons grow on a narrow one), Copy diagnostics is the Design System's size L (40 px tall), Run checks again stays S (32 px).
    await page.setViewportSize({ width: 1600, height: 1000 })
    const copy = await page.getByRole('button', { name: 'Copy diagnostics' }).boundingBox()
    const run = await page.getByRole('button', { name: 'Run checks again' }).boundingBox()
    expect(copy?.height).toBeGreaterThanOrEqual(40)
    expect(run?.height).toBeLessThan(36)
  })

  it('rules off each row of Versions and each link of Where to go', async () => {
    const page = await openAbout(browser, base, DESIGN_EMAIL)
    await page.getByRole('heading', { name: 'Versions and compatibility' }).waitFor()
    const rules = (selector: string) =>
      page.locator(selector).evaluateAll((items) =>
        items.map((item) => {
          const style = item.ownerDocument.defaultView!.getComputedStyle(item)
          return [style.borderTopWidth, style.borderTopStyle]
        })
      )
    const versions = await rules('dl > div')
    expect(versions.length).toBeGreaterThan(1)
    expect(versions[0], 'Versions: the header rule is the first').toEqual(['0px', 'none'])
    for (const rule of versions.slice(1)) expect(rule).toEqual(['1px', 'solid'])
    const links = await rules('section ul > li')
    expect(links.length).toBeGreaterThan(1)
    // Where to go: the artboard rules above the first link too.
    for (const rule of links) expect(rule).toEqual(['1px', 'solid'])
  })

  it('starts the first row of Versions and Where to go close under the header rule', async () => {
    const page = await openAbout(browser, base, DESIGN_EMAIL)
    await page.getByRole('heading', { name: 'Versions and compatibility' }).waitFor()
    const gap = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((row) => {
          const rule = row.closest('section')!.querySelector('h2')!.parentElement!
          return row.getBoundingClientRect().top - rule.getBoundingClientRect().bottom
        })
    // The artboard sits 4 CSS px under the rule (the design system's space 1); 16 was the gap before.
    expect(await gap('dl > div')).toBeLessThanOrEqual(8)
    expect(await gap('section ul > li')).toBeLessThanOrEqual(8)
  })

  it('sets the Where to go labels and the licence name in bold', async () => {
    const page = await openAbout(browser, base, DESIGN_EMAIL)
    await page.getByRole('heading', { name: 'Licence and credits' }).waitFor()
    const weightOf = (selector: string) =>
      page.locator(selector).evaluateAll((items) =>
        items.map((item) => {
          const view = item.ownerDocument.defaultView!
          const text = [...item.querySelectorAll('*')].find(
            (element) => element.children.length === 0 && element.textContent
          )
          return Number(view.getComputedStyle(text ?? item).fontWeight)
        })
      )
    const labels = await weightOf('section ul > li a')
    const licence = await weightOf('strong:text-is("AGPL-3.0-only")')
    expect(labels.length).toBeGreaterThan(0)
    for (const weight of labels) expect(weight).toBeGreaterThanOrEqual(600)
    expect(licence).toHaveLength(1)
    expect(licence[0]).toBeGreaterThanOrEqual(600)
  })

  it('marks an available update with a warning dot, its text at a contrast of at least 4.5:1', async () => {
    const service = strapi.plugin('micelio').service('about') as {
      read(): Promise<Record<string, unknown>>
    }
    const read = service.read
    service.read = async () => ({
      ...(await read.call(service)),
      update: { state: 'available', version: '0.8.0', url: 'https://example.com/notes' },
    })
    try {
      const page = await openAbout(browser, base, DESIGN_EMAIL)
      await page.getByRole('heading', { name: 'Versions and compatibility' }).waitFor()
      const row = page
        .locator('dt', { hasText: 'Update' })
        .locator('xpath=following-sibling::dd[1]')
      expect(await row.textContent()).toContain('Release 0.8.0')
      const dot = row.locator('[data-testid="update-dot"]')
      expect(await dot.getAttribute('aria-hidden')).toBe('true')
      const colours = await row.evaluate((element) => {
        const view = element.ownerDocument.defaultView!
        const dotStyle = view.getComputedStyle(element.querySelector('[data-testid="update-dot"]')!)
        return [dotStyle.backgroundColor, view.getComputedStyle(element).color]
      })
      const channels = (rgb: string) => (rgb.match(/\d+/g) ?? []).slice(0, 3).map(Number)
      // The dot is orange (red well above blue); the text is dark, 4.5:1 or more on white.
      const [dotR, , dotB] = channels(colours[0])
      expect(dotR).toBeGreaterThan(dotB + 100)
      const linear = channels(colours[1]).map((value) => {
        const channel = value / 255
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
      expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5)
      await page.context().close()
    } finally {
      service.read = read
    }
  })

  it('shows the diagnostics on a dark block with a contrast of at least 4.5:1, in light and dark mode', async () => {
    /** The relative luminance (WCAG) of a computed `rgb()` colour. */
    const luminance = (rgb: string) => {
      const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((value) => {
        const channel = Number(value) / 255
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const colours = (page: Page) =>
      page.locator('pre', { has: page.locator('code') }).evaluate((block) => {
        const style = block.ownerDocument.defaultView!.getComputedStyle(block)
        return [style.backgroundColor, style.color]
      })
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext()
      // Strapi keeps the theme in its local storage.
      await context.addInitScript(
        (value) =>
          (
            globalThis as unknown as { localStorage: { setItem(key: string, value: string): void } }
          ).localStorage.setItem('STRAPI_THEME', value),
        theme
      )
      const page = await context.newPage()
      await page.goto(`${base}/admin/auth/login`)
      await page.locator('input[name="email"]').fill(EMAIL)
      await page.locator('input[name="password"]').fill(PASSWORD)
      await page.getByRole('button', { name: 'Login' }).click()
      await page.waitForURL(/\/admin(?!\/auth)/)
      await page.goto(`${base}/admin/plugins/micelio/about`)
      await page.getByRole('heading', { name: 'Diagnostics' }).waitFor()
      const [background, text] = await colours(page)
      const [light, dark] = [luminance(background), luminance(text)].sort((a, b) => b - a)
      expect((light + 0.05) / (dark + 0.05), theme).toBeGreaterThanOrEqual(4.5)
      // The block is dark in the light theme, as on the artboard.
      if (theme === 'light') expect(luminance(background)).toBeLessThan(0.1)
      await context.close()
    }
  })

  it('has no WCAG 2.2 A or AA violation, in English and in Spanish', async () => {
    for (const [email, heading] of [
      [EMAIL, 'Versions and compatibility'],
      [SPANISH_EMAIL, 'Versiones y compatibilidad'],
    ]) {
      const page = await openAbout(browser, base, email)
      await page.getByRole('heading', { name: heading }).waitFor()
      const results = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
      expect(
        results.violations.flatMap(({ id, nodes }) =>
          nodes.map(({ target, failureSummary }) => ({ id, target, failureSummary }))
        ),
        email
      ).toEqual([])
      await page.context().close()
    }
  })
})
