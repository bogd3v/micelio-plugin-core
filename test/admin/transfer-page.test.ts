import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core } from '@strapi/strapi'
import { chromium, type Browser, type Page } from 'playwright'
import packageJson from '../../package.json'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'
import { ADMIN_EMAIL, buildFixtureSite } from '../strapi/site-archive'

const PASSWORD = 'Password1234'
const SPANISH_EMAIL = 'admin-es@example.com'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

// The Export and import page and the About page in a browser (#58).
describe('the Export and import and About pages in the admin', () => {
  let strapi: Core.Strapi
  let base: string
  let browser: Browser
  let downloads: string

  async function open(email: string, route: string): Promise<Page> {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await context.newPage()
    await page.goto(`${base}/admin/auth/login`)
    await page.locator('input[name="email"]').fill(email)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL(/\/admin(?!\/auth)/)
    await page.goto(`${base}/admin/plugins/micelio/${route}`)
    return page
  }

  const violations = async (page: Page) =>
    (
      await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
    ).violations.flatMap(({ id, nodes }) =>
      nodes.map(({ target, failureSummary }) => ({ id, target, failureSummary }))
    )

  /** The figures of the dry run's table, by row: [in file, create, update, skip]. */
  async function table(page: Page): Promise<Record<string, number[]>> {
    const rows = await page.locator('table[aria-label="Dry run · nothing written yet"] tr').all()
    const figures: Record<string, number[]> = {}
    for (const row of rows.slice(1)) {
      const cells = await row.locator('td').allTextContents()
      figures[cells[0]!] = cells.slice(1, 5).map(Number)
    }
    return figures
  }

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    base = `http://127.0.0.1:${(strapi.server.httpServer.address() as AddressInfo).port}`
    await buildFixtureSite(strapi)
    const role = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    await strapi.service('admin::user').create({
      email: SPANISH_EMAIL,
      firstname: 'Admin',
      lastname: 'Test',
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
      preferedLanguage: 'es',
    })
    downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'micelio-downloads-'))
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await browser?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
    fs.rmSync(downloads, { recursive: true, force: true })
  })

  it('exports the seeded site, imports it into a second site with "keep both" and the dry run matches the result', async () => {
    const page = await open(ADMIN_EMAIL, '_export-import')
    await page.getByRole('heading', { level: 1, name: 'Export and import' }).waitFor()
    await page.getByLabel('Site', { exact: true }).selectOption('default')
    await page.getByText('2 files').waitFor()
    await page.getByRole('button', { name: 'Prepare the export' }).click()
    const download = page.getByRole('button', { name: /^Download/ })
    await download.waitFor()
    const [saved] = await Promise.all([page.waitForEvent('download'), download.click()])
    const archive = path.join(downloads, saved.suggestedFilename())
    await saved.saveAs(archive)
    expect(archive).toMatch(/default-\d{8}T\d{6}Z\.micelio\.tar\.gz$/)

    await page.getByLabel('Site', { exact: true }).selectOption('other')
    await page.getByLabel('Archive to import').setInputFiles(archive)
    await page
      .getByRole('alert')
      .getByText(/belong to another site/)
      .waitFor()
    await expect(page.getByRole('button', { name: /^Import \d+/ }).isDisabled()).resolves.toBe(true)
    await page.getByLabel('Keep both').check()
    await page.getByRole('heading', { name: 'Dry run · nothing written yet' }).waitFor()
    // The table is read again after the policy's dry run.
    await expect.poll(async () => (await table(page)).Story?.[1]).toBe(1)
    const planned = await table(page)
    const items = Object.values(planned).reduce(
      (sum, [, create = 0, update = 0]) => sum + create + update,
      0
    )
    await page.getByRole('button', { name: /^Import \d+ items?$/ }).click()
    const report = page.getByTestId('import-report')
    await report.waitFor()

    const created = Object.entries(planned)
      .filter(([kind]) => !['Media', 'Site settings', 'Theme pin'].includes(kind))
      .reduce((sum, [, [, create = 0]]) => sum + create, 0)
    const text = (await report.textContent()) ?? ''
    expect(text).toContain(`Created ${created},`)
    expect(text).toContain(`media stored ${planned.Media![1]}, reused ${planned.Media![3]}`)
    expect(items).toBeGreaterThan(0)
    for (const [kind, [, create]] of Object.entries(planned)) {
      if (['Media', 'Site settings', 'Theme pin'].includes(kind)) continue
      await page.getByText(new RegExp(`^${kind}: created ${create},`)).waitFor()
    }
    // The second site holds the copies; the first keeps its own.
    const rows = (await strapi.db.query('api::story.story').findMany({
      populate: { site: { select: ['slug'] } },
    })) as { site: { slug: string } }[]
    expect(new Set(rows.map((row) => row.site.slug))).toEqual(new Set(['default', 'other']))
    await expect(violations(page)).resolves.toEqual([])
    await page.close()
  })

  it('shows the export and import page in Spanish with no violation', async () => {
    const page = await open(SPANISH_EMAIL, '_export-import')
    await page.getByRole('heading', { level: 1, name: 'Exportar e importar' }).waitFor()
    await page.getByRole('button', { name: 'Preparar la exportación' }).waitFor()
    await page.getByText('Elige un archivo').waitFor()
    await expect(violations(page)).resolves.toEqual([])
  })

  it('copies diagnostics that hold versions and counts, nothing of the content', async () => {
    const page = await open(ADMIN_EMAIL, 'about')
    await page.getByRole('heading', { level: 1, name: 'About Micelio' }).waitFor()
    await page.getByRole('heading', { name: 'Versions and compatibility' }).waitFor()
    await page.getByRole('button', { name: 'Copy diagnostics' }).click()
    const copied = await page.evaluate(() =>
      (navigator as unknown as { clipboard: { readText(): Promise<string> } }).clipboard.readText()
    )
    expect(copied).toContain(`micelio-core ${packageJson.version}`)
    expect(copied).toBe((await page.locator('pre code').textContent()) ?? '')
    for (const text of [
      ADMIN_EMAIL,
      'reader@example.com',
      'guest@example.com',
      'Draft title',
      'secret value',
    ]) {
      expect(copied, text).not.toContain(text)
    }
    await expect(violations(page)).resolves.toEqual([])
    await page.getByText('The update check is off (MICELIO_UPDATE_CHECK=false).').waitFor()
  })
})
