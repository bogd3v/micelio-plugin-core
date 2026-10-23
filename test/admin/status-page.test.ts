import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type Page } from 'playwright'
import { BLOCKS } from '../../contract/blocks'
import packageJson from '../../package.json'
import { SITE_UID } from '../../server/src/constants/site'
import { closedOrigin, startFrontend, type FrontendStub } from '../strapi/frontend'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'

const EMAIL = 'admin@example.com'
const PASSWORD = 'Password1234'

// What the standard requires of the admin page: WCAG 2.0, 2.1 and 2.2, levels A and AA (section 9).
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

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
    frontend = await startFrontend('0.6.3')
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    for (const [slug, url] of [
      ['blog', frontend.origin],
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
    const superAdmin = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    await strapi.service('admin::user').create({
      email: EMAIL,
      firstname: 'Admin',
      lastname: 'Test',
      password: PASSWORD,
      roles: [superAdmin.id],
      isActive: true,
    })

    browser = await chromium.launch()
    // A context of its own: axe injects its script into every frame of it.
    page = await (await browser.newContext()).newPage()
    await page.goto(`${base}/admin/auth/login`)
    await page.locator('input[name="email"]').fill(EMAIL)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL(/\/admin(?!\/auth)/)
    await page.goto(`${base}/admin/plugins/micelio`)
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

  it('has no WCAG 2.2 A or AA violation', async () => {
    const results = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
    expect(
      results.violations.flatMap(({ id, nodes }) =>
        nodes.map(({ target, failureSummary }) => ({ id, target, failureSummary }))
      )
    ).toEqual([])
  })
})
