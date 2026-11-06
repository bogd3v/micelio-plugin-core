import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'
import { startPreviewSite, type PreviewSite } from '../strapi/preview-site'

// An editorial page with the scene and the playground, so the builder's zone accepts both islands.
const SHOWCASE_UID = 'api::showcase.showcase'
const PASSWORD = 'Password1234'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

/** `expect.poll` with the time a save, a frame reload and its report take. */
const eventually = <T>(read: () => Promise<T> | T) => expect.poll(read, { timeout: 20_000 })

// The seeded page: text, a Scene (the `3d` island) and a Playground (the `runtime` island).
const SECTIONS = [
  { __component: 'section.rich-text', body: 'Open source, in plain words.' },
  { __component: 'section.scene', variant: 'inline', alt: 'A hypha network', title: 'Hyphae' },
  { __component: 'shared.playground', runtime: 'python', code: 'print(1)' },
]

describe('the islands in the builder', () => {
  let strapi: Core.Strapi
  let base: string
  let site: PreviewSite
  let browser: Browser
  let siteDocumentId = ''
  const contexts: BrowserContext[] = []
  let admins = 0
  let superAdminId = 0

  async function newShowcase(sections: object[] = SECTIONS): Promise<string> {
    const created = await strapi.documents(SHOWCASE_UID as UID.ContentType).create({
      locale: 'en',
      data: { title: 'Island page', site: siteDocumentId, sections } as never,
    })
    return created.documentId
  }

  async function open(
    documentId: string,
    options: { theme?: 'dark'; width?: number } = {}
  ): Promise<Page> {
    admins += 1
    const email = `islands-${admins}@example.com`
    await strapi.service('admin::user').create({
      email,
      firstname: 'Admin',
      lastname: 'Test',
      password: PASSWORD,
      roles: [superAdminId],
      isActive: true,
    })
    const context = await browser.newContext({
      viewport: { width: options.width ?? 1920, height: 1200 },
      bypassCSP: true,
    })
    contexts.push(context)
    if (options.theme) {
      await context.addInitScript(
        (theme) => localStorage.setItem('STRAPI_THEME', theme),
        options.theme
      )
    }
    const page = await context.newPage()
    await page.goto(`${base}/admin/auth/login`)
    await page.locator('input[name="email"]').fill(email)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL(/\/admin(?!\/auth)/)
    await page.goto(`${base}/admin/plugins/micelio/builder/${SHOWCASE_UID}/${documentId}`)
    await page.locator('[data-block="rich-text"]').waitFor()
    await eventually(() => frameOf(page).locator('[data-myc-block]').count()).toBeGreaterThan(0)
    return page
  }

  const frameOf = (page: Page) => page.frameLocator('main iframe >> nth=-1')

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    strapi.config.set('plugin::micelio.budgets', {
      ...strapi.config.get<Record<string, unknown>>('plugin::micelio.budgets'),
      contentTypes: [SHOWCASE_UID],
    })
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    site = await startPreviewSite()
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    siteDocumentId = ((await sites.findFirst()) as { documentId: string }).documentId
    await sites.update({ documentId: siteDocumentId, data: { url: site.origin } as never })
    const apiToken = (await strapi.service('admin::api-token').create({
      name: 'islands-test',
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

  it('the badge shows each kind on the seeded blocks', async () => {
    const page = await open(await newShowcase())

    // The palette: one badge per island, with its kind, and none on a block that is not one.
    const kindIn = (selector: string) =>
      page.locator(selector).locator('[data-testid="island-badge"]').getAttribute('data-kind')
    expect(await kindIn('[data-block="scene"]')).toBe('3d')
    expect(await kindIn('[data-block="playground"]')).toBe('runtime')
    expect(
      await page.locator('[data-block="rich-text"] [data-testid="island-badge"]').count()
    ).toBe(0)
    expect(
      await page
        .locator('[data-block="scene"] [data-testid="island-badge"]')
        .getAttribute('aria-label')
    ).toBe('3D island · in view · 151.3 kB')
    expect(
      await page
        .locator('[data-block="playground"] [data-testid="island-badge"]')
        .getAttribute('aria-label')
    ).toBe('Runtime island · in view · 406.7 kB')

    // An island's row says what it loads once used; any other block's says what it adds to the page.
    const costOf = (block: string) => page.locator(`[data-block="${block}"]`).textContent()
    expect(await costOf('scene')).toContain('island · 151.3 kB')
    expect(await costOf('playground')).toContain('island · 406.7 kB')
    expect(await costOf('rich-text')).toMatch(/Rich text\d+(\.\d)? kB$/)

    // The block list: the same mark on the two island rows, in the page's order.
    expect(
      await page
        .getByRole('region', { name: /Page blocks/ })
        .locator('[data-testid="island-badge"]')
        .evaluateAll((badges) => badges.map((badge) => badge.getAttribute('data-kind')))
    ).toEqual(['3d', 'runtime'])

    // The preview: the Scene carries the icon in its corner while nobody points at it.
    const rest = page.getByTestId('island-rest')
    await rest.waitFor()
    expect(await rest.locator('[data-testid="island-badge"]').getAttribute('data-kind')).toBe('3d')
    expect(await page.getByTestId('island-rest').count()).toBe(1)

    // Hovering it says how it loads and what it weighs; the corner icon gives way.
    await frameOf(page).locator('[data-section="scene"]').hover()
    await eventually(() => page.getByTestId('island-hover').textContent()).toBe(
      '3D · in view · 151.3 kB'
    )
    expect(await page.getByTestId('island-rest').count()).toBe(0)

    // Selected: the label carries the kind, and the panel the badge and what it costs the visitor.
    await frameOf(page).locator('[data-section="scene"]').click()
    await eventually(() => page.getByTestId('selection-label').textContent()).toBe(
      'Scene · 3D island · 2 of 3'
    )
    const panel = page.getByRole('complementary', { name: 'Selected block' })
    expect(await panel.getByTestId('island-badge').textContent()).toBe('3D · in view · 151.3 kB')
    expect(await panel.getByTestId('island-cost').textContent()).toContain(
      'The island adds 151.3 kB of script, loaded when it scrolls into view.'
    )
    // Its static alternative is required: the empty poster and the filled alt text say so.
    expect(await panel.getByTestId('alternative-poster').textContent()).toContain(
      'Required before the page goes to review'
    )

    // A Playground's expected output is its alternative: marked required, and the run is not offered yet.
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]', { hasText: 'Playground' })
      .click()
    await eventually(() => page.getByTestId('alternative-missing').textContent()).toContain(
      'Required before the page goes to review'
    )
    expect(await page.getByLabel('Expected output').count()).toBe(1)
    expect(
      await page.getByRole('button', { name: 'Run here and fill expected output' }).isDisabled()
    ).toBe(true)
    await page.getByLabel('Expected output').fill('6')
    await eventually(() => page.getByTestId('alternative-missing').count()).toBe(0)

    // A block that is not an island has none of this.
    await frameOf(page).locator('[data-section="rich-text"]').click()
    await eventually(() => page.getByTestId('selection-label').textContent()).toBe(
      'Rich text · 1 of 3'
    )
    expect(await page.getByTestId('island-cost').count()).toBe(0)
  })

  it('the island label toggles one block to static', async () => {
    const page = await open(await newShowcase())
    const received = () =>
      frameOf(page)
        .locator('body')
        .evaluate(() =>
          (
            globalThis as unknown as { __mycReceived: { type: string; payload: unknown }[] }
          ).__mycReceived
            .filter((message) => message.type === 'micelio:renderMode')
            .map(
              (message) =>
                message.payload as { address: { index: number; block: string }; mode: string }
            )
        )

    await frameOf(page).locator('[data-section="scene"]').click()
    const toggle = page.getByRole('button', { name: 'Show Scene as its static alternative' })
    await eventually(() => toggle.getAttribute('aria-pressed')).toBe('false')
    // The toggle sends nothing until it is used, and `micelio:patch` never carries a mode.
    expect(await received()).toEqual([])

    await toggle.click()
    await eventually(() => toggle.getAttribute('aria-pressed')).toBe('true')
    await eventually(received).toEqual([
      {
        address: expect.objectContaining({ zone: 'sections', index: 1, block: 'scene' }),
        mode: 'static',
      },
    ])
    // The frame has the Scene as its alternative and nothing else changed.
    await eventually(() =>
      frameOf(page).locator('[data-myc-block="scene"]').getAttribute('data-myc-mode')
    ).toBe('static')
    expect(
      await frameOf(page).locator('[data-myc-block="rich-text"]').getAttribute('data-myc-mode')
    ).toBe(null)
    // Once nobody points at it, the badge in its corner says what replaced it.
    await frameOf(page).locator('[data-section="rich-text"]').click()
    await eventually(() => page.getByTestId('island-rest').textContent()).toBe('3D → poster')

    // An edit saves the draft and the frame loads it again: the page it loads has the block in its
    // dynamic render, and the builder sends the mode again after the frame's `ready`.
    await frameOf(page)
      .locator('body')
      .evaluate(() => {
        ;(globalThis as unknown as { __before: boolean }).__before = true
      })
    await frameOf(page).locator('[data-section="scene"]').click()
    await page.getByLabel('Title').fill('Hyphae, changed')
    await eventually(() =>
      frameOf(page)
        .locator('body')
        .evaluate(() => (globalThis as unknown as { __before?: boolean }).__before === undefined)
    ).toBe(true)
    await eventually(received).toEqual([
      { address: expect.objectContaining({ index: 1, block: 'scene' }), mode: 'static' },
    ])
    await eventually(() =>
      frameOf(page).locator('[data-myc-block="scene"]').getAttribute('data-myc-mode')
    ).toBe('static')

    // Toggled back, the island is dynamic again.
    await page.getByRole('button', { name: 'Show Scene as its static alternative' }).click()
    await eventually(() =>
      frameOf(page).locator('[data-myc-block="scene"]').getAttribute('data-myc-mode')
    ).toBe('dynamic')
  })

  it('the toolbar meter counts the islands that load on demand, and says nothing without one', async () => {
    const meter = (page: Page) => page.getByTestId('toolbar-meter')
    const bare = await open(await newShowcase([SECTIONS[0]!]))
    await meter(bare).waitFor()
    expect(await bare.getByTestId('toolbar-on-demand').count()).toBe(0)

    site.weight.onDemandKb = { scene: 151.3 }
    try {
      const page = await open(await newShowcase())
      await eventually(() => page.getByTestId('toolbar-on-demand').textContent()).toBe(
        '+ 1 island on demand'
      )
    } finally {
      site.weight.onDemandKb = undefined
    }
  })

  it('the static toggle keeps only its icon on a narrow frame, and its name', async () => {
    const wide = await open(await newShowcase())
    await frameOf(wide).locator('[data-section="scene"]').click()
    const name = 'Show Scene as its static alternative'
    await eventually(() => wide.getByRole('button', { name }).textContent()).toBe('static')

    const narrow = await open(await newShowcase(), { width: 1280 })
    await frameOf(narrow).locator('[data-section="scene"]').click()
    await eventually(() => narrow.getByRole('button', { name }).count()).toBe(1)
    expect(await narrow.getByRole('button', { name }).textContent()).toBe('')
  })

  it('has no accessibility violation on the builder with islands, in light and dark', async () => {
    for (const theme of [undefined, 'dark'] as const) {
      const page = await open(await newShowcase(), { theme })
      await frameOf(page).locator('[data-section="scene"]').click()
      await page.getByTestId('island-cost').waitFor()
      const results = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
      expect(results.violations.map(({ id }) => id)).toEqual([])
    }
  })
})
