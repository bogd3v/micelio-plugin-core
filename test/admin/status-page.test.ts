import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { BLOCKS } from '../../contract/blocks'
import en from '../../admin/src/translations/en.json'
import es from '../../admin/src/translations/es.json'
import packageJson from '../../package.json'
import { SITE_UID } from '../../server/src/constants/site'
import { STATUS_READ_PERMISSION } from '../../server/src/constants/status'
import { startFrontend, type FrontendStub } from '../strapi/frontend'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'

const EMAIL = 'admin@example.com'
// A second super admin whose interface language is Spanish: Strapi 5.59 switches the admin to the
// user's `preferedLanguage` once they log in (`features/Auth` of `@strapi/admin`).
const SPANISH_EMAIL = 'admin-es@example.com'
// A role with the status permission and none of the extension fixture's.
const STATUS_ONLY_EMAIL = 'status-only@example.com'
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

/** What the page measures of an element: `Element` is not in this file's type-check. */
type Box = { getBoundingClientRect(): { left: number; right: number } }

type Session = Awaited<ReturnType<BrowserContext['storageState']>>

type HostCheckBody = {
  checkedAt: string
  environment: string
  results: { id: string; status: string; required: boolean; fix?: string }[]
}

/**
 * Opens the status page with the answer of `GET /micelio/status` changed by `change`.
 *
 * @param login - An email to log in as, or the session of a user already logged in: Strapi
 * answers a sixth login of one email in a few minutes with 429, and the suite logs `EMAIL` in five
 * times before these tests.
 */
async function openChanged(
  browser: Browser,
  base: string,
  login: string | Session,
  change: (hostCheck: HostCheckBody) => void
): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(typeof login === 'string' ? {} : { storageState: login }),
  })
  const own = await context.newPage()
  await own.route('**/micelio/status', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    change(body.data.hostCheck)
    await route.fulfill({ response, json: body })
  })
  if (typeof login === 'string') {
    await own.goto(`${base}/admin/auth/login`)
    await own.locator('input[name="email"]').fill(login)
    await own.locator('input[name="password"]').fill(PASSWORD)
    await own.getByRole('button', { name: 'Login' }).click()
    await own.waitForURL(/\/admin(?!\/auth)/)
  }
  await own.goto(`${base}/admin/plugins/micelio`)
  await own.getByRole('heading', { name: /Host check|Comprobación del host/ }).waitFor()
  return own
}

/** The Design System's light colours the page's tokens resolve to, as `rgb()` strings. */
const COLOURS = {
  success600: 'rgb(50, 128, 72)',
  warning600: 'rgb(217, 130, 47)',
  danger600: 'rgb(208, 43, 32)',
  neutral500: 'rgb(142, 142, 169)',
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
    // Both stubs are open until both ports are known: two `closedOrigin()` calls in a row can give
    // the same port, and then the two sites share one frontend and none is "Not available".
    const blogStub = await startFrontend()
    const docsStub = await startFrontend()
    const blogOrigin = blogStub.origin
    const docsOrigin = docsStub.origin
    await Promise.all([blogStub.close(), docsStub.close()])
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    for (const [slug, url] of [
      ['blog', blogOrigin],
      ['docs', docsOrigin],
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

    const roles = strapi.service('admin::role')
    const statusOnly = (await roles.create({
      name: 'Status only',
      description: 'Status only',
    })) as {
      id: number
    }
    await roles.assignPermissions(statusOnly.id, [
      { action: STATUS_READ_PERMISSION, subject: null, properties: {}, conditions: [] },
    ])
    await strapi.service('admin::user').create({
      email: STATUS_ONLY_EMAIL,
      firstname: 'Status',
      lastname: 'Only',
      password: PASSWORD,
      roles: [statusOnly.id],
      isActive: true,
    })

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
    expect(text).toContain('also available as')
    expect(text).toContain('npx micelio doctor')
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

  it('shows the Micelio plugins and the contracts', async () => {
    const main = page.getByRole('main')
    const siblings = main.locator('section').filter({
      has: page.getByRole('heading', { name: 'Micelio plugins' }),
    })
    const siblingsText = (await siblings.textContent()) ?? ''
    // A plugin with what it registered, and one that registered nothing.
    expect(siblingsText).toContain('@micelio/extension-fixture 0.0.0')
    expect(siblingsText).toContain('fixture-page')
    expect(siblingsText).toContain('fixture-profile')
    expect(siblingsText).toContain('fixture-checks')
    expect(siblingsText).toContain('fixture-members')
    expect(siblingsText).toContain('@micelio/hook-recorder 0.0.0')
    expect(siblingsText).toContain('registers no extension point')
    expect(siblingsText).not.toContain(en['status.siblings.hidden'])
    const contracts = main.locator('section').filter({
      has: page.getByRole('heading', { name: 'Contracts this core exposes' }),
    })
    const contractsText = (await contracts.textContent()) ?? ''
    // The two cards side by side are as tall as each other.
    const heights = [await siblings.boundingBox(), await contracts.boundingBox()].map(
      (box) => box?.height ?? 0
    )
    expect(heights[0]).toBeGreaterThan(0)
    expect(heights[0]).toBe(heights[1])
    expect(contractsText).toContain(`Blocks in the catalogue${BLOCKS.length}`)
    expect(contractsText).toContain('Draft, In review, Scheduled, Published')
    expect(contractsText).toContain('beforeTransition')
    expect(contractsText).toContain('blockCatalogueChanged')
    expect(contractsText).toContain('registerExportSection')
  })

  it('tells a plugin whose registrations the role may not see from one that registered none', async () => {
    const restricted = await openStatusPage(browser, base, STATUS_ONLY_EMAIL)
    const heading = restricted.getByRole('heading', { name: 'Micelio plugins' })
    await heading.waitFor()
    const item = (name: string) =>
      restricted
        .getByRole('main')
        .locator('section')
        .filter({ has: heading })
        .getByRole('listitem')
        .filter({ hasText: name })
        .textContent()
    const fixture = (await item('@micelio/extension-fixture')) ?? ''
    expect(fixture).toContain(en['status.siblings.hidden'])
    expect(fixture).not.toContain('registers no extension point')
    expect(fixture).not.toContain('fixture-page')
    const recorder = (await item('@micelio/hook-recorder')) ?? ''
    expect(recorder).toContain('registers no extension point')
    expect(recorder).not.toContain(en['status.siblings.hidden'])
    await restricted.context().close()
  })

  it('runs the host check again and shows the new report without a reload', async () => {
    const releaseLine = page.getByRole('row').filter({ hasText: 'Frontend release line' })
    await expect(releaseLine.textContent()).resolves.toContain(
      `${frontend.origin} is not reachable`
    )
    await page.getByRole('button', { name: 'Run host check' }).click()
    await releaseLine.getByText(`${frontend.origin} runs 0.6.3`).waitFor()
    await page.getByRole('button', { name: 'Run host check' }).waitFor()
    // The verdict is announced, since the table changes where the focus is not.
    await expect(page.getByRole('status').allTextContents()).resolves.toContainEqual(
      expect.stringContaining('Every required check passes.')
    )
  })

  it('shows the plugin core, frontend, sites and block catalogue cards from the status report', async () => {
    const cards = page.getByRole('list', { name: 'Summary' })
    const sites = (await strapi.documents(SITE_UID as UID.ContentType).findMany()) as unknown as {
      name: string
      hosts: string[] | null
      isDefault: boolean
    }[]
    const hosts = sites.reduce((sum, site) => sum + (site.hosts?.length ?? 0), 0)
    const card = (label: string) => cards.getByRole('listitem').filter({ hasText: label })
    await expect(card('Plugin core').textContent()).resolves.toBe(
      `Plugin core${packageJson.version}supports core line ${packageJson.micelio}`
    )
    await expect(card('Sites').textContent()).resolves.toBe(
      `Sites${sites.length}1 default · ${hosts} hosts`
    )
    await expect(card('Block catalogue').textContent()).resolves.toBe(
      `Block catalogue${BLOCKS.length}blocks`
    )
    // The default site has no URL yet: no frontend is connected.
    await expect(card('Frontend').textContent()).resolves.toBe(
      'FrontendNoneThe default site has no URL, so no frontend is connected.'
    )
    // Give it the URL of the frontend that answers, and read the page again.
    const sitesService = strapi.documents(SITE_UID as UID.ContentType)
    const [defaultDocument] = await sitesService.findMany({ filters: { isDefault: true } })
    await sitesService.update({
      documentId: defaultDocument.documentId,
      data: { url: frontend.origin } as never,
    })
    try {
      const again = await openStatusPage(browser, base, EMAIL)
      const frontendCard = again
        .getByRole('list', { name: 'Summary' })
        .getByRole('listitem')
        .filter({ hasText: 'Frontend' })
      await expect(frontendCard.textContent()).resolves.toBe('Frontend0.6.3healthy')
      await again.context().close()
    } finally {
      await sitesService.update({
        documentId: defaultDocument.documentId,
        data: { url: null } as never,
      })
    }
  })

  it('shows Pass, Warning, Fail and Skipped pills, the count badge and a banner with the fix of each warning', async () => {
    /** Opens the page with the host check report changed by `change`. */
    async function openWith(
      change: (results: { id: string; status: string; required: boolean; fix?: string }[]) => void
    ): Promise<Page> {
      const context = await browser.newContext()
      const own = await context.newPage()
      await own.route('**/micelio/status', async (route) => {
        const response = await route.fetch()
        const body = await response.json()
        change(body.data.hostCheck.results)
        await route.fulfill({ response, json: body })
      })
      await own.goto(`${base}/admin/auth/login`)
      await own.locator('input[name="email"]').fill(EMAIL)
      await own.locator('input[name="password"]').fill(PASSWORD)
      await own.getByRole('button', { name: 'Login' }).click()
      await own.waitForURL(/\/admin(?!\/auth)/)
      await own.goto(`${base}/admin/plugins/micelio`)
      await own.getByRole('heading', { name: 'Host check' }).waitFor()
      return own
    }
    const resultOf = (own: Page, title: string) =>
      own.getByRole('row').filter({ hasText: title }).textContent()

    // A required check fails, two that are not required fail, one is skipped, the rest pass.
    const mixed = await openWith((results) => {
      for (const result of results) {
        if (result.id === 'node') Object.assign(result, { status: 'fail', required: true })
        if (['frontend-release-line', 'preview-frame-src'].includes(result.id)) {
          Object.assign(result, { status: 'fail', required: false })
        }
        if (result.status === 'fail') result.fix = 'Fix it.'
      }
    })
    await expect(resultOf(mixed, 'Node version')).resolves.toContain('Fail')
    await expect(resultOf(mixed, 'Frontend release line')).resolves.toContain('Warning')
    await expect(resultOf(mixed, 'PostgreSQL in production')).resolves.toContain('Skipped')
    await expect(resultOf(mixed, 'Security middlewares')).resolves.toContain('Pass')
    // Sentence case: the pills are not turned to upper case.
    await expect(
      mixed
        .getByRole('row')
        .filter({ hasText: 'Node version' })
        .getByText('Fail', { exact: true })
        .evaluate(
          (element) => element.ownerDocument.defaultView!.getComputedStyle(element).textTransform
        )
    ).resolves.toBe('none')
    const section = mixed.locator('section').filter({
      has: mixed.getByRole('heading', { name: 'Host check' }),
    })
    await expect(section.textContent()).resolves.toContain('1 failure · 2 warnings')
    // One banner for each of the three, with the translated fix.
    const banners = section.getByRole('note')
    await expect(banners.count()).resolves.toBe(3)
    const bannerText = (await banners.allTextContents()).join('\n')
    expect(bannerText).toContain(`Node version. ${en['status.hostCheck.check.node.fix']}`)
    expect(bannerText).toContain(en['status.hostCheck.check.frontend-release-line.fix'])
    expect(bannerText).toContain(en['status.hostCheck.check.preview-frame-src.fix'])
    await mixed.context().close()

    // Every check passes: no count badge and no banner.
    const clean = await openWith((results) => {
      for (const result of results) {
        if (result.status === 'fail') {
          Object.assign(result, { status: 'pass' })
          delete result.fix
        }
      }
    })
    const cleanSection = clean.locator('section').filter({
      has: clean.getByRole('heading', { name: 'Host check' }),
    })
    await expect(cleanSection.getByRole('note').count()).resolves.toBe(0)
    await expect(cleanSection.textContent()).resolves.not.toMatch(/warning|failure/)
    await clean.context().close()
  })

  it('runs the host check from Run host check in the header, one run at a time', async () => {
    const own = await openStatusPage(browser, base, EMAIL)
    await own.getByRole('heading', { name: 'Host check' }).waitFor()
    const header = own.locator('[data-strapi-header]')
    // The button is in the page header, not in the card, and nothing else says Run again.
    await expect(header.getByRole('button', { name: 'Run host check' }).count()).resolves.toBe(1)
    await expect(own.getByRole('button', { name: 'Run again' }).count()).resolves.toBe(0)
    const posts: string[] = []
    own.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/micelio/status/host-check')) {
        posts.push(request.url())
      }
    })
    // Slow answer: the second press comes while the first run is still going.
    await own.route('**/micelio/status/host-check', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800))
      await route.continue()
    })
    const button = header.getByRole('button', { name: 'Run host check' })
    await button.click()
    const running = header.getByRole('button', { name: 'Running the host check' })
    await running.waitFor()
    await expect(running.getAttribute('aria-disabled')).resolves.toBe('true')
    await running.dispatchEvent('click')
    await header.getByRole('button', { name: 'Run host check' }).waitFor()
    expect(posts).toHaveLength(1)
    await own.context().close()
  })

  /** The session of the super admin the suite logged in as, for a page of its own. */
  const session = () => page.context().storageState()

  it('colours the dot of each pill and of the count badge by its result, with bold text', async () => {
    /** The dot before the word `word` in `scope`, and the weight of the word. */
    const pillOf = (scope: Page | ReturnType<Page['getByRole']>, word: string) =>
      scope.getByText(word, { exact: true }).evaluate((text) => {
        const view = text.ownerDocument.defaultView!
        const dot = text.previousElementSibling!
        return {
          dot: view.getComputedStyle(dot).backgroundColor,
          hidden: dot.getAttribute('aria-hidden'),
          weight: view.getComputedStyle(text).fontWeight,
        }
      })
    const mixed = await openChanged(browser, base, await session(), ({ results }) => {
      for (const result of results) {
        if (result.id === 'node') Object.assign(result, { status: 'fail', required: true })
        if (['frontend-release-line', 'preview-frame-src'].includes(result.id)) {
          Object.assign(result, { status: 'fail', required: false })
        }
      }
    })
    const row = (title: string) => mixed.getByRole('row').filter({ hasText: title })
    const expected = (dot: string) => ({ dot, hidden: 'true', weight: '600' })
    await expect(pillOf(row('Node version'), 'Fail')).resolves.toEqual(expected(COLOURS.danger600))
    await expect(pillOf(row('Frontend release line'), 'Warning')).resolves.toEqual(
      expected(COLOURS.warning600)
    )
    await expect(pillOf(row('Security middlewares'), 'Pass')).resolves.toEqual(
      expected(COLOURS.success600)
    )
    await expect(pillOf(row('PostgreSQL in production'), 'Skipped')).resolves.toEqual(
      expected(COLOURS.neutral500)
    )
    // The badge with a failure is red, one with only warnings is orange.
    const section = mixed.locator('section').filter({
      has: mixed.getByRole('heading', { name: 'Host check' }),
    })
    await expect(pillOf(section, '1 failure · 2 warnings')).resolves.toEqual(
      expected(COLOURS.danger600)
    )
    await mixed.context().close()
    const warned = await openChanged(browser, base, await session(), ({ results }) => {
      for (const result of results) {
        if (result.id === 'preview-frame-src')
          Object.assign(result, { status: 'fail', required: false })
      }
    })
    await expect(pillOf(warned, '1 warning')).resolves.toEqual(expected(COLOURS.warning600))
    await warned.context().close()
  })

  it('shows the four stat cards at one height, each value and note on one line, at 1280 px wide with a frontend that reports no version', async () => {
    const quiet = await startFrontend()
    const sitesService = strapi.documents(SITE_UID as UID.ContentType)
    const [defaultDocument] = await sitesService.findMany({ filters: { isDefault: true } })
    await sitesService.update({
      documentId: defaultDocument.documentId,
      data: { url: quiet.origin } as never,
    })
    try {
      const own = await openChanged(browser, base, await session(), () => {})
      const cards = own.getByRole('list', { name: 'Summary' }).getByRole('listitem')
      await expect(cards.count()).resolves.toBe(4)
      const measures = await cards.evaluateAll((items) =>
        items.map((item) => {
          const view = item.ownerDocument.defaultView!
          const lines = [...item.querySelectorAll('dd')].map((line) => {
            const style = view.getComputedStyle(line)
            return {
              text: line.textContent,
              fontSize: style.fontSize,
              lines: Math.round(line.getBoundingClientRect().height / parseFloat(style.lineHeight)),
            }
          })
          return { height: item.getBoundingClientRect().height, lines }
        })
      )
      expect(new Set(measures.map(({ height }) => height)).size).toBe(1)
      // The artboard's cards are 124 px high.
      expect(measures[0].height).toBeLessThanOrEqual(124)
      for (const { lines } of measures) {
        for (const line of lines) expect(line.lines, line.text ?? '').toBe(1)
        // The value is the theme's `fontSizes[6]`, 2.8rem.
        expect(lines[0].fontSize).toBe('28px')
      }
      const frontendCard = cards.filter({ hasText: 'Frontend' })
      // The en dash stands for the missing version and is hidden from assistive technology.
      await expect(frontendCard.getByText('–').getAttribute('aria-hidden')).resolves.toBe('true')
      await expect(frontendCard.textContent()).resolves.toBe('Frontend–no version · healthy')
      await own.context().close()
    } finally {
      await sitesService.update({
        documentId: defaultDocument.documentId,
        data: { url: null } as never,
      })
      await quiet.close()
    }
  })

  it("shows the frontend's health with a dot in its tone", async () => {
    const sitesService = strapi.documents(SITE_UID as UID.ContentType)
    const [defaultDocument] = await sitesService.findMany({ filters: { isDefault: true } })
    const dotOf = async (origin: string) => {
      await sitesService.update({
        documentId: defaultDocument.documentId,
        data: { url: origin } as never,
      })
      const own = await openChanged(browser, base, await session(), () => {})
      const health = own
        .getByRole('list', { name: 'Summary' })
        .getByRole('listitem')
        .filter({ hasText: 'Frontend' })
        .getByText(/^(healthy|not available)$/)
      const shown = {
        text: await health.textContent(),
        ...(await health.evaluate((text) => {
          const dot = text.previousElementSibling!
          return {
            colour: text.ownerDocument.defaultView!.getComputedStyle(dot).backgroundColor,
            hidden: dot.getAttribute('aria-hidden'),
          }
        })),
      }
      await own.context().close()
      return shown
    }
    try {
      await expect(dotOf(frontend.origin)).resolves.toEqual({
        text: 'healthy',
        colour: COLOURS.success600,
        hidden: 'true',
      })
      const closed = await startFrontend()
      await closed.close()
      await expect(dotOf(closed.origin)).resolves.toEqual({
        text: 'not available',
        colour: COLOURS.neutral500,
        hidden: 'true',
      })
    } finally {
      await sitesService.update({
        documentId: defaultDocument.documentId,
        data: { url: null } as never,
      })
    }
  })

  it('shows every card title in the weight of the Host check title', async () => {
    const weights = await page
      .getByRole('main')
      .getByRole('heading', { level: 2 })
      .evaluateAll((titles) =>
        titles.map((title) => ({
          title: title.textContent,
          weight: title.ownerDocument.defaultView!.getComputedStyle(title).fontWeight,
        }))
      )
    const titles = weights.map(({ title }) => title)
    for (const title of [
      'Host check',
      'Micelio plugins',
      'Contracts this core exposes',
      'Frontends',
      'Sites',
    ]) {
      expect(titles).toContain(title)
    }
    // The plugin's checks card too: the extension fixture registers one.
    expect(titles.length).toBeGreaterThanOrEqual(6)
    for (const { title, weight } of weights) expect(weight, title ?? '').toBe('600')
  })

  it("lines up the host check table's first column with the card's title, its rules running to the card's edges", async () => {
    const own = await openChanged(browser, base, await session(), ({ results }) => {
      for (const result of results) {
        if (result.id === 'preview-frame-src')
          Object.assign(result, { status: 'fail', required: false })
      }
    })
    const section = own.locator('section').filter({
      has: own.getByRole('heading', { name: 'Host check' }),
    })
    const edges = await section.evaluate((card) => {
      const left = (element: Box | null) => element!.getBoundingClientRect().left
      const right = (element: Box | null) => element!.getBoundingClientRect().right
      const rows = [...card.querySelectorAll('tr')]
      const cards = card.getBoundingClientRect()
      return {
        cardLeft: cards.left,
        cardRight: cards.right,
        titleLeft: left(card.querySelector('h2')),
        headerRowHeight: card.querySelector('thead tr')!.getBoundingClientRect().height,
        headerTexts: [...card.querySelectorAll('thead th span')].map((span) => span.textContent),
        headerLastRight: right(card.querySelector('thead th:last-child span')),
        headerTextLeft: left(card.querySelector('th span')),
        firstCellTextLeft: left(card.querySelector('tbody tr td span')),
        rows: rows.map((row) => ({ left: left(row), right: right(row) })),
        lastCellRights: [...card.querySelectorAll('tbody tr td:last-child > div > span')].map(
          right
        ),
        badgeRight: right(card.querySelector('h2')!.parentElement!.nextElementSibling),
      }
    })
    const near = (value: number, wanted: number) => expect(Math.abs(value - wanted)).toBeLessThan(1)
    near(edges.headerTextLeft, edges.titleLeft)
    near(edges.firstCellTextLeft, edges.titleLeft)
    expect(edges.rows.length).toBeGreaterThan(2)
    for (const row of edges.rows) {
      near(row.left, edges.cardLeft)
      near(row.right, edges.cardRight)
    }
    for (const right of edges.lastCellRights) near(right, edges.badgeRight)
    // The header's last word ends where the pills do, not where its column starts.
    near(edges.headerLastRight, edges.badgeRight)
    // The artboard's header row is 41.6 px (65 of 1531 display px): the Design System's is 56.
    expect(edges.headerRowHeight).toBeLessThanOrEqual(42)
    expect(edges.headerTexts).toEqual(['Check', 'Found', 'Result'])
    await own.context().close()
  })

  it('shows when the host check last ran as a relative time, with the full date in its title', async () => {
    const twoMinutesAgo = () => new Date(Date.now() - 125_000).toISOString()
    let environment = ''
    let checkedAt = ''
    const own = await openChanged(browser, base, await session(), (hostCheck) => {
      checkedAt = twoMinutesAgo()
      environment = hostCheck.environment
      hostCheck.checkedAt = checkedAt
    })
    const line = own.locator('section').filter({
      has: own.getByRole('heading', { name: 'Host check' }),
    })
    const time = line.locator('time')
    await expect(time.textContent()).resolves.toBe('2 minutes ago')
    await expect(time.getAttribute('datetime')).resolves.toBe(checkedAt)
    await expect(time.getAttribute('title')).resolves.toBe(
      await own.evaluate(
        (iso) =>
          new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' }).format(
            new Date(iso)
          ),
        checkedAt
      )
    )
    await expect(time.locator('xpath=..').textContent()).resolves.toBe(
      `Last run 2 minutes ago, in the ${environment} environment · also available as npx micelio doctor`
    )
    await own.context().close()
    const spanish = await openChanged(browser, base, SPANISH_EMAIL, (hostCheck) => {
      hostCheck.checkedAt = twoMinutesAgo()
    })
    await expect(spanish.locator('time').textContent()).resolves.toBe('hace 2 minutos')
    await expect(spanish.locator('time').locator('xpath=..').textContent()).resolves.toContain(
      'Última ejecución hace 2 minutos, en el entorno'
    )
    await spanish.context().close()
  })

  it('shows Manage sites, a link to the Sites page, only to a role that may read sites', async () => {
    const own = await openChanged(browser, base, await session(), () => {})
    const header = own.locator('[data-strapi-header]')
    const run = header.getByRole('button', { name: 'Run host check' })
    const manage = header.getByRole('link', { name: 'Manage sites' })
    await expect(manage.getAttribute('href')).resolves.toBe('/admin/plugins/micelio/sites')
    await expect(manage.getAttribute('target')).resolves.toBeNull()
    // Both buttons are the Design System's size L, and Manage sites follows Run host check.
    const heights = [await run.boundingBox(), await manage.boundingBox()].map((box) => box?.height)
    expect(heights).toEqual([40, 40])
    expect((await run.boundingBox())!.x).toBeLessThan((await manage.boundingBox())!.x)
    // It opens in the admin's router: the same page, no new window.
    const pages = own.context().pages().length
    await manage.click()
    await own.waitForURL(/\/admin\/plugins\/micelio\/sites$/)
    expect(own.context().pages()).toHaveLength(pages)
    await own.context().close()

    // A role with the status permission and not the Sites page's.
    const restricted = await openStatusPage(browser, base, STATUS_ONLY_EMAIL)
    await restricted.getByRole('heading', { name: 'Host check' }).waitFor()
    await expect(
      restricted
        .locator('[data-strapi-header]')
        .getByRole('button', { name: 'Run host check' })
        .count()
    ).resolves.toBe(1)
    await expect(restricted.getByRole('link', { name: 'Manage sites' }).count()).resolves.toBe(0)
    await restricted.context().close()
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

    it('shows the plugins and the contracts in Spanish', () => {
      expect(text).toContain('Plugins de Micelio')
      expect(text).toContain('no registra ningún punto de extensión')
      expect(text).toContain('Contratos que expone este núcleo')
      expect(text).toContain('Estados editoriales')
    })

    it('shows each result of the host check in Spanish', async () => {
      // `textContent`: the badges are upper case on screen only (`text-transform`).
      const resultOf = (title: string) =>
        spanish.getByRole('row').filter({ hasText: title }).textContent()
      await expect(resultOf('Versión de Node')).resolves.toContain('Pasa')
      // SQLite outside production: skipped. The stub frontends are not in frame-src: a warning,
      // as that check is not required.
      await expect(resultOf('PostgreSQL en producción')).resolves.toContain('Omitida')
      await expect(resultOf('frame-src para la vista previa')).resolves.toContain('Aviso')
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
