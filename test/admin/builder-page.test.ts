import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'
import { startPreviewSite, type PreviewSite } from '../strapi/preview-site'

// An editorial page with sections, so the builder's zone accepts the blocks of the test app.
const LANDING_UID = 'api::landing.landing'
// A type whose dynamic zone is `blocks`, which the builder cannot compose.
const STORY_UID = 'api::story.story'
const PASSWORD = 'Password1234'
// The admin the suite's own calls to the admin API are made as.
const SUITE_ADMIN = 'suite-admin@example.com'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

/** `expect.poll` with the time a save, a frame reload and its report take. */
const eventually = <T>(read: () => Promise<T> | T) => expect.poll(read, { timeout: 20_000 })

describe('the builder page in the admin', () => {
  let strapi: Core.Strapi
  let base: string
  let site: PreviewSite
  let browser: Browser
  let siteDocumentId = ''
  const contexts: BrowserContext[] = []
  let admins = 0
  let superAdminId = 0
  let adminToken: string | undefined

  /** A call to an admin route as the first admin of the suite, which the settings and the second session use. */
  async function admin(
    path: string,
    init: { method?: string; json?: unknown } = {}
  ): Promise<Response> {
    if (!adminToken) {
      const login = await fetch(`${base}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: SUITE_ADMIN, password: PASSWORD }),
      })
      adminToken = ((await login.json()) as { data: { token: string } }).data.token
    }
    return fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    })
  }

  const builderPath = (documentId: string, query = '') =>
    `${base}/admin/plugins/micelio/builder/${LANDING_UID}/${documentId}${query}`

  async function newLanding(sections: object[] = [], title = 'Built page'): Promise<string> {
    const created = await strapi.documents(LANDING_UID as UID.ContentType).create({
      locale: 'en',
      data: { title, site: siteDocumentId, sections } as never,
    })
    return created.documentId
  }

  async function sectionsOf(
    documentId: string
  ): Promise<{ __component: string; id: number; [key: string]: unknown }[]> {
    const draft = (await strapi.documents(LANDING_UID as UID.ContentType).findOne({
      documentId,
      locale: 'en',
      status: 'draft',
      populate: {
        sections: {
          on: {
            'section.rich-text': true,
            'section.feature-grid': { populate: ['items'] },
            'section.logo-cloud': true,
          },
        },
      } as never,
    })) as unknown as { sections: { __component: string; id: number }[] }
    return draft.sections
  }

  async function open(
    path: string,
    options: { reducedMotion?: 'reduce'; theme?: 'dark' } = {}
  ): Promise<Page> {
    admins += 1
    const email = `builder-${admins}@example.com`
    await strapi.service('admin::user').create({
      email,
      firstname: 'Admin',
      lastname: 'Test',
      password: PASSWORD,
      roles: [superAdminId],
      isActive: true,
    })
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1200 },
      bypassCSP: true,
      reducedMotion: options.reducedMotion ?? 'no-preference',
    })
    contexts.push(context)
    // Strapi keeps the theme the editor chose in this key.
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
    await page.goto(path)
    return page
  }

  /** The block ids the frame shows, in order. */
  const shown = (page: Page) =>
    page
      .frameLocator('main iframe >> nth=-1')
      .locator('[data-myc-block]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-myc-block')))
  const frameOf = (page: Page) => page.frameLocator('main iframe >> nth=-1')
  const listed = (page: Page) =>
    page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]')
      .allTextContents()

  async function violationsOf(page: Page): Promise<unknown[]> {
    const results = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
    return results.violations.flatMap(({ id, nodes }) =>
      nodes.map(({ target }) => ({ id, target }))
    )
  }

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    strapi.config.set('plugin::micelio.budgets', {
      ...strapi.config.get<Record<string, unknown>>('plugin::micelio.budgets'),
      contentTypes: [LANDING_UID],
    })
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    site = await startPreviewSite()
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    const defaultSite = (await sites.findFirst()) as { documentId: string }
    siteDocumentId = defaultSite.documentId
    await sites.update({ documentId: siteDocumentId, data: { url: site.origin } as never })
    const apiToken = (await strapi.service('admin::api-token').create({
      name: 'builder-test',
      type: 'custom',
      lifespan: null,
      permissions: ['plugin::micelio.preview.exchange', 'plugin::micelio.preview.draft'],
    })) as { accessKey: string }
    site.connect({ base, apiToken: apiToken.accessKey, adminOrigin: base })
    const superAdmin = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    superAdminId = superAdmin.id
    await strapi.service('admin::user').create({
      email: SUITE_ADMIN,
      firstname: 'Suite',
      lastname: 'Admin',
      password: PASSWORD,
      roles: [superAdmin.id],
      isActive: true,
    })
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

  it('composes a three-block landing from scratch and keeps it after a reload', async () => {
    const documentId = await newLanding()
    const page = await open(builderPath(documentId))
    await page.locator('[data-block="rich-text"]').waitFor()
    await eventually(() => page.locator('iframe[title^="Preview of"]').count()).toBe(1)

    // Insert from the palette: a block of text, then (after it) a feature grid and a logo cloud.
    await page.locator('[data-block="rich-text"]').click()
    await page.getByLabel('Body').fill('Open source, in plain words.')
    // The text reaches the frame as a patch before any save, and the save follows.
    await eventually(() =>
      page.frameLocator('main iframe >> nth=-1').locator('[data-field="body"]').textContent()
    ).toBe('Open source, in plain words.')
    await eventually(async () => (await sectionsOf(documentId)).map((s) => s.body)).toEqual([
      'Open source, in plain words.',
    ])
    await page.locator('[data-block="feature-grid"]').click()
    await page.locator('[data-block="logo-cloud"]').click()
    await eventually(() => shown(page)).toEqual(['rich-text', 'feature-grid', 'logo-cloud'])
    expect((await sectionsOf(documentId)).map((s) => s.__component)).toEqual([
      'section.rich-text',
      'section.feature-grid',
      'section.logo-cloud',
    ])

    // Edit a title and a presentation option of the grid.
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]', { hasText: 'Feature grid' })
      .click()
    await page.getByLabel('Title').fill('Why it matters')
    await page
      .getByRole('group', { name: 'Columns' })
      .getByRole('button', { name: '4', exact: true })
      .click()
    await eventually(() =>
      page
        .getByRole('group', { name: 'Columns' })
        .getByRole('button', { name: '4', exact: true })
        .getAttribute('aria-pressed')
    ).toBe('true')
    await eventually(async () => (await sectionsOf(documentId))[1]?.columns).toBe('4')
    await eventually(() =>
      frameOf(page).locator('[data-section="feature-grid"] h2').textContent()
    ).toBe('Why it matters')

    // Move the logo cloud up with ⌥↑: the preview shows the new order after the save.
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]', { hasText: 'Logo cloud' })
      .click()
    await page.keyboard.press('Alt+ArrowUp')
    await eventually(() => listed(page)).toEqual(
      ['Rich text1', 'Logo cloud2', 'Feature grid3'].map((text) =>
        expect.stringContaining(text.slice(0, -1))
      )
    )
    await eventually(() => shown(page)).toEqual(['rich-text', 'logo-cloud', 'feature-grid'])

    // Remove the logo cloud again.
    await page.getByRole('button', { name: 'Remove' }).click()
    await eventually(() => shown(page)).toEqual(['rich-text', 'feature-grid'])
    await eventually(async () => (await sectionsOf(documentId)).length).toBe(2)

    // A reload keeps the autosaved state.
    await page.reload()
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]')
      .first()
      .waitFor()
    await eventually(async () => (await listed(page)).length).toBe(2)
    await eventually(() => shown(page)).toEqual(['rich-text', 'feature-grid'])
    // Its patches and selections were messages of the protocol, with the version of the draft.
    const received = (await frameOf(page)
      .locator('body')
      .evaluate('window.__mycReceived.map((m) => m.type)')) as string[]
    expect(received).toContain('micelio:select')
  })

  it('selects a block from a click in the page and draws its outline from the frame’s boxes', async () => {
    const documentId = await newLanding([
      { __component: 'section.rich-text', body: 'One' },
      { __component: 'section.feature-grid', title: 'Two', columns: '3' },
    ])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['rich-text', 'feature-grid'])
    await frameOf(page).locator('[data-myc-index="1"]').click()
    await page
      .getByRole('complementary', { name: 'Selected block' })
      .getByText('block 2 of 2')
      .waitFor()
    const outline = page.getByTestId('selected-outline')
    await outline.getByText('Feature grid · 2 of 2').waitFor()
    // The outline sits over the block the frame reported.
    const block = await frameOf(page).locator('[data-myc-index="1"]').boundingBox()
    const drawn = await outline.locator('div').first().boundingBox()
    expect(Math.abs((drawn?.y ?? 0) - ((block?.y ?? 0) - 2))).toBeLessThan(2)
    expect(await violationsOf(page)).toEqual([])
  })

  it('drags a block of the palette into the gap under the first block', async () => {
    const documentId = await newLanding([
      { __component: 'section.rich-text', body: 'One' },
      { __component: 'section.feature-grid', title: 'Two', columns: '3' },
    ])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['rich-text', 'feature-grid'])
    const row = page.locator('[data-block="logo-cloud"]')
    const rowBox = (await row.boundingBox())!
    const first = (await frameOf(page).locator('[data-myc-index="0"]').boundingBox())!
    await page.mouse.move(rowBox.x + 20, rowBox.y + 10)
    await page.mouse.down()
    await page.mouse.move(rowBox.x + 60, rowBox.y + 40, { steps: 4 })
    await page.getByTestId('drop-layer').waitFor()
    await page.mouse.move(first.x + 100, first.y + first.height + 2, { steps: 8 })
    await page.getByText('DROP HERE').waitFor()
    await page.mouse.up()
    await eventually(() => shown(page)).toEqual(['rich-text', 'logo-cloud', 'feature-grid'])
  })

  it('shows the conflict notice and overwrites nothing when another session saved first', async () => {
    const documentId = await newLanding([{ __component: 'section.rich-text', body: 'Original' }])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['rich-text'])
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]')
      .first()
      .click()
    // The other session: a save through the Content Manager's route, as its form makes.
    const other = await admin(
      `/content-manager/collection-types/${LANDING_UID}/${documentId}?locale=en`,
      {
        method: 'PUT',
        json: { title: 'Saved by the other session' },
      }
    )
    expect(other.status).toBe(200)
    await page.getByLabel('Body').fill('My edit')
    await page.getByText('This page was saved somewhere else').waitFor()
    // Nothing of this session reached the CMS, and the other session's save stands.
    expect((await sectionsOf(documentId)).map((s) => s.body)).toEqual(['Original'])
    const stored = (await strapi
      .documents(LANDING_UID as UID.ContentType)
      .findOne({ documentId, locale: 'en', status: 'draft' })) as unknown as { title: string }
    expect(stored.title).toBe('Saved by the other session')
    await page.getByRole('button', { name: 'Load their version' }).waitFor()
    await page.getByRole('button', { name: 'Load their version' }).click()
    await page.getByText('This page was saved somewhere else').waitFor({ state: 'hidden' })
    expect(await violationsOf(page)).toEqual([])
  })

  it('undoes a removal: the block comes back in the page and in the preview', async () => {
    const documentId = await newLanding([
      { __component: 'section.rich-text', body: 'One' },
      { __component: 'section.logo-cloud', title: 'Two' },
    ])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['rich-text', 'logo-cloud'])
    await frameOf(page).locator('[data-myc-index="1"]').click()
    await page.getByRole('button', { name: 'Remove' }).click()
    await eventually(() => shown(page)).toEqual(['rich-text'])
    await page.getByRole('button', { name: 'Undo' }).click()
    await eventually(() => shown(page)).toEqual(['rich-text', 'logo-cloud'])
    await eventually(async () => (await sectionsOf(documentId)).map((s) => s.__component)).toEqual([
      'section.rich-text',
      'section.logo-cloud',
    ])
  })

  it('searches the palette, and refuses a block the page type’s catalogue excludes', async () => {
    const set = await admin('/micelio/block-settings/logo-cloud?site=default', {
      method: 'PUT',
      json: { allowedPageTypes: ['long-read'] },
    })
    expect(set.status).toBe(200)
    try {
      const documentId = await newLanding([{ __component: 'section.rich-text', body: 'One' }])
      const page = await open(builderPath(documentId))
      const row = page.locator('[data-block="logo-cloud"]')
      await row.waitFor()
      expect(await row.getAttribute('aria-disabled')).toBe('true')
      await page.getByText('Not allowed on standard pages').waitFor()
      // A click on it inserts nothing.
      await row.click({ force: true })
      await page.waitForTimeout(1500)
      expect((await sectionsOf(documentId)).map((s) => s.__component)).toEqual([
        'section.rich-text',
      ])

      await page.getByLabel('Search blocks').fill('feat')
      await page.getByText('1 of 5 match "feat"').waitFor()
      expect(await page.locator('[data-block="feature-grid"] b').textContent()).toBe('Feat')
      await page.getByLabel('Search blocks').fill('carousel')
      await page.getByText('No block matches "carousel".').waitFor()
      // No empty group of results under the message.
      expect(await page.getByRole('region', { name: 'Results' }).count()).toBe(0)
      await page.getByRole('button', { name: 'clear' }).click()
      await page.locator('[data-block="rich-text"]').waitFor()
    } finally {
      await admin('/micelio/block-settings/logo-cloud?site=default', { method: 'DELETE' })
    }
  })

  it('says by how much a page already over its budget is over, in the palette row’s note', async () => {
    // A standard page may weigh 120 kB: one block of 199.2 kB leaves -79.19999999999999.
    const { baseKb, blockKb } = site.weight
    site.weight.baseKb = 0
    site.weight.blockKb = 199.2
    try {
      const documentId = await newLanding([{ __component: 'section.rich-text', body: 'One' }])
      const page = await open(builderPath(documentId))
      await eventually(() => shown(page)).toEqual(['rich-text'])
      const palette = page.getByRole('complementary', { name: 'Block palette' })
      await palette
        .getByRole('region', { name: 'Over the remaining budget' })
        .waitFor({ timeout: 20_000 })
      const note = palette.getByText('This page is 79.2 kB over its budget.').first()
      await note.waitFor()
      expect(await note.textContent()).toBe(
        'This page is 79.2 kB over its budget. You can add it, but publishing will be refused until the page fits.'
      )
      expect(await palette.getByText(/kB left on this page/).count()).toBe(0)
      expect(await violationsOf(page)).toEqual([])
    } finally {
      site.weight.baseKb = baseKb
      site.weight.blockKb = blockKb
    }
  })

  /** The messages of the protocol the frame received, by type. */
  const receivedBy = (page: Page, type: string) =>
    frameOf(page)
      .locator('body')
      .evaluate(
        `window.__mycReceived.filter((m) => m.type === ${JSON.stringify(type)}).map((m) => m.payload)`
      ) as Promise<{ address: unknown; reveal?: boolean }[]>

  /** The selections of a block the frame was asked for: the page also tells it, once, that nothing is selected. */
  const selectsOf = async (page: Page) =>
    (await receivedBy(page, 'micelio:select')).filter(({ address }) => address !== null)

  /** Lets the admin and the frame run a few frames, so a message they would send has been sent. */
  async function settle(page: Page, frames = 10): Promise<void> {
    for (let i = 0; i < frames; i += 1) {
      await page.evaluate('new Promise((done) => requestAnimationFrame(() => done(null)))')
    }
  }

  it('asks the frame to scroll to a selection once, and leaves it where the editor scrolled', async () => {
    const documentId = await newLanding([
      { __component: 'section.rich-text', body: 'One' },
      { __component: 'section.feature-grid', title: 'Two', columns: '3' },
      { __component: 'section.logo-cloud', title: 'Three' },
    ])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['rich-text', 'feature-grid', 'logo-cloud'])
    await frameOf(page).locator('body').evaluate("document.body.style.paddingBottom = '4000px'")
    // Select from the list: outside the frame, so the frame is asked to scroll to the block.
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]', { hasText: 'Feature grid' })
      .click()
    await eventually(async () => (await selectsOf(page)).length).toBe(1)
    expect((await selectsOf(page))[0]?.reveal).toBe(true)
    // The editor scrolls the preview away and the frame reports it; the page must not pull it back.
    await frameOf(page).locator('body').evaluate('window.scrollTo(0, 2000)')
    await page.mouse.move(600, 500)
    await page.mouse.move(640, 540)
    for (let i = 0; i < 10; i += 1) {
      await settle(page, 3)
      expect(await frameOf(page).locator('body').evaluate('window.scrollY')).toBe(2000)
    }
    expect(await selectsOf(page)).toHaveLength(1)
    // A save loads the draft again and the page asks the frame to scroll to the block once more
    // (the frame may be a new document, so this counts what it received since).
    await page.getByLabel('Title').fill('Two, changed')
    await eventually(async () => (await sectionsOf(documentId))[1]?.title).toBe('Two, changed')
    await eventually(
      async () => (await selectsOf(page)).filter(({ reveal }) => reveal === true).length
    ).toBeGreaterThan(0)
  })

  /** Whether the block `id` of the frame is inside the frame's viewport. */
  const isInView = (page: Page, id: string) =>
    frameOf(page)
      .locator('body')
      .evaluate(
        '(() => { const box = document.querySelector(\'[data-myc-block="' +
          id +
          '"]\').getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight })()'
      )

  /** A page longer than the frame: the first block's text fills several screens. */
  const longLanding = () =>
    newLanding([
      { __component: 'section.rich-text', body: 'Long text. '.repeat(3000) },
      { __component: 'section.feature-grid', title: 'Two', columns: '3' },
      { __component: 'section.logo-cloud', title: 'Three' },
    ])

  it('brings the edited block back into view after the save reloads the frame', async () => {
    const documentId = await longLanding()
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['rich-text', 'feature-grid', 'logo-cloud'])
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]', { hasText: 'Feature grid' })
      .click()
    await eventually(() => isInView(page, 'feature-grid')).toBe(true)
    await page.getByLabel('Title').fill('Two, changed')
    await eventually(async () => (await sectionsOf(documentId))[1]?.title).toBe('Two, changed')
    await eventually(() =>
      frameOf(page).locator('[data-myc-block="feature-grid"]').innerText()
    ).toContain('Two, changed')
    await eventually(() => isInView(page, 'feature-grid')).toBe(true)
  })

  it('does not ask the frame to scroll after a save when nothing is selected', async () => {
    const documentId = await longLanding()
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['rich-text', 'feature-grid', 'logo-cloud'])
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]', { hasText: 'Feature grid' })
      .click()
    // Remove the block and select nothing before the autosave: the save has no selection to show.
    await page.getByRole('button', { name: 'Remove' }).click()
    await page.getByRole('button', { name: '+ Add a block here' }).dispatchEvent('click')
    await eventually(async () => (await sectionsOf(documentId)).length).toBe(2)
    await eventually(() => shown(page)).toEqual(['rich-text', 'logo-cloud'])
    await settle(page, 30)
    expect((await selectsOf(page)).filter(({ reveal }) => reveal === true)).toHaveLength(0)
  })

  it('addresses a block by its place in the zone when the site disabled one in the middle', async () => {
    const documentId = await newLanding([
      { __component: 'section.rich-text', body: 'One' },
      { __component: 'section.logo-cloud', title: 'Two' },
      { __component: 'section.feature-grid', title: 'Three', columns: '3' },
    ])
    const set = await admin('/micelio/block-settings/logo-cloud?site=default', {
      method: 'PUT',
      json: { enabled: false },
    })
    expect(set.status).toBe(200)
    try {
      const page = await open(builderPath(documentId))
      await eventually(() => shown(page)).toEqual(['rich-text', 'logo-cloud', 'feature-grid'])
      // A click on the third block selects the third, not the one after the disabled block.
      await frameOf(page).locator('[data-myc-index="2"]').click()
      const panel = page.getByRole('complementary', { name: 'Selected block' })
      await panel.getByText('block 3 of 3').waitFor()
      await panel.getByRole('heading', { name: 'Feature grid' }).waitFor()
      // The disabled block has a panel too: it can be moved and removed here.
      await frameOf(page).locator('[data-myc-index="1"]').click()
      await panel.getByText('block 2 of 3').waitFor()
      // A copy would be refused as an addition of a disabled block: it is not offered.
      // (the panel's button and the mark over the page)
      const copies = page.getByRole('button', { name: 'Duplicate' })
      await eventually(() => copies.count()).toBe(2)
      expect(
        await copies.evaluateAll((els) =>
          els.map((el) => (el as unknown as { disabled: boolean }).disabled)
        )
      ).toEqual([true, true])
      await panel.getByRole('button', { name: 'Remove' }).click()
      await eventually(async () =>
        (await sectionsOf(documentId)).map((s) => s.__component)
      ).toEqual(['section.rich-text', 'section.feature-grid'])
    } finally {
      await admin('/micelio/block-settings/logo-cloud?site=default', { method: 'DELETE' })
    }
  })

  it('does not offer the builder for a type whose zone is not sections', async () => {
    const story = await strapi.documents(STORY_UID as UID.ContentType).create({
      locale: 'en',
      data: { title: 'A story', site: siteDocumentId, blocks: [] } as never,
    })
    const landing = await newLanding([], 'A landing')
    const builder = await open(
      `${base}/admin/plugins/micelio/builder/${STORY_UID}/${story.documentId}?locale=en`
    )
    await builder.getByText('This content type has no sections zone').waitFor()
    expect(await builder.getByTestId('save-status').count()).toBe(0)
    const ofLanding = await open(
      `${base}/admin/plugins/micelio/preview/${LANDING_UID}/${landing}?locale=en`
    )
    await ofLanding.getByRole('link', { name: 'Open in the builder' }).waitFor()
    const ofStory = await open(
      `${base}/admin/plugins/micelio/preview/${STORY_UID}/${story.documentId}?locale=en`
    )
    await ofStory.getByText('Draft saved').waitFor()
    expect(await ofStory.getByRole('link', { name: 'Open in the builder' }).count()).toBe(0)
  })

  it('keeps my version after the other session removed a block, and saves it', async () => {
    const documentId = await newLanding([
      { __component: 'section.rich-text', body: 'One' },
      { __component: 'section.logo-cloud', title: 'Two' },
    ])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['rich-text', 'logo-cloud'])
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]')
      .first()
      .click()
    // The other session drops the logo cloud, through the Content Manager's route.
    const [first] = await sectionsOf(documentId)
    const other = await admin(
      `/content-manager/collection-types/${LANDING_UID}/${documentId}?locale=en`,
      {
        method: 'PUT',
        json: { sections: [{ id: first!.id, __component: 'section.rich-text', body: 'One' }] },
      }
    )
    expect(other.status).toBe(200)
    await page.getByLabel('Body').fill('My edit')
    await page.getByText('This page was saved somewhere else').waitFor()
    await page.getByRole('button', { name: 'Keep my version' }).click()
    await eventually(async () =>
      (await sectionsOf(documentId)).map((section) => [section.__component, section.body])
    ).toEqual([
      ['section.rich-text', 'My edit'],
      ['section.logo-cloud', undefined],
    ])
    await page.getByText('This page was saved somewhere else').waitFor({ state: 'hidden' })
    await eventually(() => page.getByTestId('save-status').textContent()).toContain('Saved')
  })

  it('drops the "not saved" status and the alert when an undo brings the page back to the CMS', async () => {
    const documentId = await newLanding()
    const page = await open(builderPath(documentId))
    const status = page.getByTestId('save-status')
    await page.locator('[data-block="rich-text"]').click()
    await status.getByText('Not saved: a required field is empty').waitFor()
    await page.getByRole('button', { name: 'Undo' }).click()
    await eventually(() => status.textContent()).not.toContain('Not saved')
  })

  it('drops the refusal when an undo brings the page back to what the CMS holds', async () => {
    const documentId = await newLanding([{ __component: 'section.rich-text', body: 'One' }])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['rich-text'])
    const set = await admin('/micelio/block-settings/logo-cloud?site=default', {
      method: 'PUT',
      json: { enabled: false },
    })
    expect(set.status).toBe(200)
    try {
      await page.locator('[data-block="logo-cloud"]').click()
      const goTo = page.getByRole('button', { name: 'Go to the block' })
      await goTo.waitFor()
      await page.getByRole('button', { name: 'Undo' }).click()
      await goTo.waitFor({ state: 'detached' })
      await eventually(() => page.getByTestId('save-status').textContent()).not.toContain(
        'Not saved'
      )
    } finally {
      await admin('/micelio/block-settings/logo-cloud?site=default', { method: 'DELETE' })
    }
  })

  it('saves a page that holds a disabled block with a hidden option, whatever is edited', async () => {
    const documentId = await newLanding([
      { __component: 'section.rich-text', body: 'One' },
      { __component: 'section.feature-grid', title: 'Grid', items: [{ title: 'First' }] },
    ])
    const set = await admin('/micelio/block-settings/feature-grid?site=default', {
      method: 'PUT',
      json: { enabled: false },
    })
    expect(set.status).toBe(200)
    try {
      const page = await open(builderPath(documentId))
      await eventually(() => shown(page)).toEqual(['rich-text', 'feature-grid'])
      await page
        .getByRole('region', { name: /Page blocks/ })
        .locator('[data-block-key]', { hasText: 'Rich text' })
        .click()
      await page.getByLabel('Body').fill('Edited')
      await eventually(async () => (await sectionsOf(documentId)).map((s) => s.body)).toEqual([
        'Edited',
        undefined,
      ])
      await eventually(() => page.getByTestId('save-status').textContent()).toContain('Saved')
    } finally {
      await admin('/micelio/block-settings/feature-grid?site=default', { method: 'DELETE' })
    }
  })

  it('keeps my version after the other session removed an item of a block both hold', async () => {
    const documentId = await newLanding([
      {
        __component: 'section.feature-grid',
        title: 'Grid',
        items: [{ title: 'A' }, { title: 'B' }],
      },
    ])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['feature-grid'])
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]')
      .first()
      .click()
    const [grid] = (await sectionsOf(documentId)) as unknown as {
      id: number
      items: { id: number; title: string }[]
    }[]
    // The other session drops the second item.
    const other = await admin(
      `/content-manager/collection-types/${LANDING_UID}/${documentId}?locale=en`,
      {
        method: 'PUT',
        json: {
          sections: [
            {
              id: grid!.id,
              __component: 'section.feature-grid',
              title: 'Grid',
              items: [{ id: grid!.items[0]!.id, title: 'A' }],
            },
          ],
        },
      }
    )
    expect(other.status).toBe(200)
    await page.getByLabel('Title').fill('Mine')
    await page.getByText('This page was saved somewhere else').waitFor()
    await page.getByRole('button', { name: 'Keep my version' }).click()
    await eventually(async () =>
      (await sectionsOf(documentId)).map((s) => [
        s.title,
        (s.items as { title: string }[]).map((item) => item.title),
      ])
    ).toEqual([['Mine', ['A', 'B']]])
    await eventually(() => page.getByTestId('save-status').textContent()).toContain('Saved')
  })

  /** A page whose grid the other session cut to one item, opened with the grid selected. */
  async function gridAfterTheirCut() {
    const documentId = await newLanding([
      { __component: 'section.rich-text', body: 'One' },
      {
        __component: 'section.feature-grid',
        title: 'Grid',
        items: [{ title: 'A' }, { title: 'B' }],
      },
    ])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['rich-text', 'feature-grid'])
    const [first, grid] = (await sectionsOf(documentId)) as unknown as {
      id: number
      items: { id: number }[]
    }[]
    return { documentId, page, first: first!, grid: grid! }
  }

  const theirSave = (documentId: string, sections: object[]) =>
    admin(`/content-manager/collection-types/${LANDING_UID}/${documentId}?locale=en`, {
      method: 'PUT',
      json: { sections },
    })

  it('keeps saving after keep my version re-created a block the other session removed, with its items', async () => {
    const { documentId, page, first } = await gridAfterTheirCut()
    await page.locator('[data-block-key]').first().click()
    const other = await theirSave(documentId, [
      { id: first.id, __component: 'section.rich-text', body: 'One' },
    ])
    expect(other.status).toBe(200)
    await page.getByLabel('Body').fill('Mine')
    await page.getByText('This page was saved somewhere else').waitFor()
    await page.getByRole('button', { name: 'Keep my version' }).click()
    await eventually(() => page.getByTestId('save-status').textContent()).toContain('Saved')
    // The next edit is the one that was refused: the block's items named ids it no longer had.
    await page.getByLabel('Body').fill('Mine again')
    await eventually(async () => (await sectionsOf(documentId)).map((s) => s.body)).toEqual([
      'Mine again',
      undefined,
    ])
    await eventually(() => page.getByTestId('save-status').textContent()).toContain('Saved')
    // Strapi keeps an empty live region of its own: what counts is an alert with text.
    await eventually(async () =>
      (await page.getByRole('alert').allTextContents()).filter(Boolean)
    ).toEqual([])
  })

  it('does not bring back an item id the other session removed when the editor undoes after keep my version', async () => {
    const { documentId, page, grid } = await gridAfterTheirCut()
    await page.locator('[data-block-key]').nth(1).click()
    // A change that says so: its message keeps the Undo button for the rest of the visit.
    await page
      .getByRole('complementary', { name: 'Selected block' })
      .getByRole('button', { name: 'Move up' })
      .click()
    await eventually(async () => (await sectionsOf(documentId)).map((s) => s.__component)).toEqual([
      'section.feature-grid',
      'section.rich-text',
    ])
    await eventually(() => page.getByTestId('save-status').textContent()).toContain('Saved')
    // The other session cuts the grid's second item.
    const [moved, rich] = await sectionsOf(documentId)
    const other = await theirSave(documentId, [
      {
        id: moved!.id,
        __component: 'section.feature-grid',
        title: 'Grid',
        items: [{ id: grid.items[0]!.id, title: 'A' }],
      },
      { id: rich!.id, __component: 'section.rich-text', body: 'One' },
    ])
    expect(other.status).toBe(200)
    await page.getByLabel('Title').fill('Mine')
    await page.getByText('This page was saved somewhere else').waitFor()
    await page.getByRole('button', { name: 'Keep my version' }).click()
    await eventually(() => page.getByTestId('save-status').textContent()).toContain('Saved')
    // The step before the typing holds the grid with the item the other session cut, by its old id.
    await page.getByRole('button', { name: 'Undo' }).click()
    await eventually(async () =>
      (await sectionsOf(documentId)).map((s) => [
        s.title,
        (s.items as { title: string }[] | undefined)?.map((item) => item.title),
      ])
    ).toEqual([
      ['Grid', ['A', 'B']],
      [undefined, undefined],
    ])
    await eventually(() => page.getByTestId('save-status').textContent()).toContain('Saved')
    // Strapi keeps an empty live region of its own: what counts is an alert with text.
    await eventually(async () =>
      (await page.getByRole('alert').allTextContents()).filter(Boolean)
    ).toEqual([])
  })

  it('shows the panel’s fields in Strapi’s dark theme with text that differs from its background', async () => {
    const documentId = await newLanding([
      { __component: 'section.rich-text', body: 'One' },
      { __component: 'section.feature-grid', title: 'Grid', items: [{ title: 'A' }] },
    ])
    const page = await open(builderPath(documentId), { theme: 'dark' })
    await eventually(() => shown(page)).toEqual(['rich-text', 'feature-grid'])
    const panel = page.getByRole('complementary', { name: 'Selected block' })
    const colours = (locator: ReturnType<Page['locator']>) =>
      locator.evaluate((el) => {
        const style = el.ownerDocument.defaultView!.getComputedStyle(el)
        return { text: style.color, background: style.backgroundColor }
      })
    const readable = async (locator: ReturnType<Page['locator']>) => {
      const { text, background } = await colours(locator)
      expect(text).not.toBe(background)
      // The Design System's dark `neutral0` is not white.
      expect(background).not.toBe('rgb(255, 255, 255)')
    }
    // A textarea (the body) and an input (the grid's title, then the item's).
    await page.locator('[data-block-key]').first().click()
    await readable(panel.getByLabel('Body'))
    await page.locator('[data-block-key]').nth(1).click()
    await readable(panel.getByLabel('Title'))
    await panel.getByRole('button', { name: /Item 1/ }).click()
    await readable(panel.getByLabel('Title'))
  })

  it('shows the reason of a block’s problem beside its selection label, not under it', async () => {
    const documentId = await newLanding([{ __component: 'section.rich-text', body: 'One' }])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['rich-text'])
    await page.locator('[data-block-key]').first().click()
    await page.getByLabel('Body').fill('')
    const problem = page.getByTestId('problem-label')
    await problem.waitFor()
    const selection = (await page.getByTestId('selection-label').boundingBox())!
    const reason = (await problem.boundingBox())!
    const overlap =
      reason.x < selection.x + selection.width &&
      selection.x < reason.x + reason.width &&
      reason.y < selection.y + selection.height &&
      selection.y < reason.y + reason.height
    expect(overlap).toBe(false)
  })

  it('keeps the panel beside the page in the admin at 1280 px, the width of the artboards', async () => {
    const documentId = await newLanding([{ __component: 'section.rich-text', body: 'One' }])
    const page = await open(builderPath(documentId))
    await page.setViewportSize({ width: 1280, height: 900 })
    await eventually(() => shown(page)).toEqual(['rich-text'])
    await page.locator('[data-block-key]').first().click()
    const panel = page.getByRole('complementary', { name: 'Selected block' })
    await panel.waitFor()
    const frame = (await page.locator('main iframe >> nth=-1').boundingBox())!
    const side = (await panel.boundingBox())!
    // Beside the preview, not below it, and not past the window.
    expect(side.x).toBeGreaterThanOrEqual(frame.x + frame.width)
    expect(side.y).toBeLessThan(frame.y + 100)
    expect(side.x + side.width).toBeLessThanOrEqual(1280)
  })

  it('says why the server refused a save, in its words, with a way to the block', async () => {
    const documentId = await newLanding([{ __component: 'section.rich-text', body: 'One' }])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['rich-text'])
    // The site disables the block after the page read its catalogue: the server is the one to refuse.
    const set = await admin('/micelio/block-settings/logo-cloud?site=default', {
      method: 'PUT',
      json: { enabled: false },
    })
    expect(set.status).toBe(200)
    try {
      await page.locator('[data-block="logo-cloud"]').click()
      const words = 'The logo-cloud block is disabled on this site'
      await eventually(() => page.getByText(words).count()).toBeGreaterThanOrEqual(2)
      await page.getByText('The page was not saved').first().waitFor()
      expect((await sectionsOf(documentId)).map((s) => s.__component)).toEqual([
        'section.rich-text',
      ])
      // The block is not stored: the way to it is in this page, and selects the block just added.
      await page.getByRole('button', { name: 'Go to the block' }).click()
      await page
        .getByRole('complementary', { name: 'Selected block' })
        .getByText('block 2 of 2')
        .waitFor()
      expect(await violationsOf(page)).toEqual([])
    } finally {
      await admin('/micelio/block-settings/logo-cloud?site=default', { method: 'DELETE' })
    }
  })

  it('holds the save while a required field is empty, and saves once it has text', async () => {
    const documentId = await newLanding()
    const page = await open(builderPath(documentId))
    await page.locator('[data-block="rich-text"]').click()
    const status = page.getByTestId('save-status')
    await status.getByText('Not saved: a required field is empty').waitFor()
    await page.getByRole('button', { name: 'Save' }).click()
    await status.getByText('Not saved: a required field is empty').waitFor()
    expect(await sectionsOf(documentId)).toEqual([])
    await page.getByLabel('Body').fill('Now it has text')
    await eventually(async () => (await sectionsOf(documentId)).map((s) => s.body)).toEqual([
      'Now it has text',
    ])
    await eventually(() => status.textContent()).toContain('Saved')
  })

  it('edits an item one level down, goes up with Esc, and undoes only the typing', async () => {
    const documentId = await newLanding([
      { __component: 'section.rich-text', body: 'One' },
      { __component: 'section.feature-grid', title: 'Grid', items: [{ title: 'First item' }] },
    ])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['rich-text', 'feature-grid'])
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]', { hasText: 'Feature grid' })
      .click()
    const panel = page.getByRole('complementary', { name: 'Selected block' })
    // Esc goes up one level, from the item to the block.
    await panel.getByRole('button', { name: /Item 1/ }).click()
    await panel.getByText('Esc goes up one level').waitFor()
    // The item's component, as the artboard's type line.
    await panel.getByText('section.feature-item').waitFor()
    // The page's label names the parent and the item, as the Block states artboard does.
    // One breadcrumb tag: the parent, then the item as a chip.
    const crumb = page.getByTestId('selected-outline')
    await crumb.getByText('Feature grid ›').waitFor()
    await crumb.getByText('Item 1', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await panel.getByText('Esc goes up one level').waitFor({ state: 'detached' })
    // A step of its own before the typing: move the grid up.
    await panel.getByRole('button', { name: 'Move up' }).click()
    await eventually(() => listed(page)).toEqual([
      expect.stringContaining('Feature grid'),
      expect.stringContaining('Rich text'),
    ])
    await panel.getByRole('button', { name: /Item 1/ }).click()
    await page.getByLabel('Title').fill('Changed item')
    // Undo takes back the typing, and not the move that came before it.
    await page.getByRole('button', { name: 'Undo' }).click()
    await eventually(() => page.getByLabel('Title').inputValue()).toBe('First item')
    expect(await listed(page)).toEqual([
      expect.stringContaining('Feature grid'),
      expect.stringContaining('Rich text'),
    ])
  })

  it('implements of the keyboard only what the issue asks: move with ⌥↑ and Esc', async () => {
    const documentId = await newLanding([
      { __component: 'section.rich-text', body: 'One' },
      { __component: 'section.logo-cloud', title: 'Two' },
    ])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['rich-text', 'logo-cloud'])
    // The complete keyboard is bogd3v/micelio-plugin-core#50: nothing announces a shortcut it lacks.
    expect(await page.locator('[aria-keyshortcuts*="ArrowLeft"]').count()).toBe(0)
    await frameOf(page).locator('[data-myc-index="1"]').click()
    await page.getByRole('button', { name: 'Remove' }).click()
    await eventually(() => shown(page)).toEqual(['rich-text'])
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    // `/` does not move focus to the search, and Ctrl+Z does not undo: only the Undo control does.
    await page.keyboard.press('/')
    expect(
      await page.getByLabel('Search blocks').evaluate((el) => el.ownerDocument.activeElement === el)
    ).toBe(false)
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Meta+z')
    await settle(page, 5)
    expect(await shown(page)).toEqual(['rich-text'])
    await page.getByRole('button', { name: 'Undo' }).click()
    await eventually(() => shown(page)).toEqual(['rich-text', 'logo-cloud'])
  })

  it('moves the admin only with the motion tokens, and not at all with reduced motion', async () => {
    const documentId = await newLanding([{ __component: 'section.rich-text', body: 'One' }])
    const tokens = (page: Page) =>
      page.evaluate(
        "(() => { const style = getComputedStyle(document.querySelector('main').parentElement); return ['--m-fast', '--m-base', '--m-slow'].map((name) => style.getPropertyValue(name).trim()) })()"
      ) as Promise<string[]>
    const normal = await open(builderPath(documentId))
    await normal.locator('[data-block="rich-text"]').waitFor()
    expect(await tokens(normal)).toEqual(['120ms', '200ms', '320ms'])
    const reduced = await open(builderPath(documentId), { reducedMotion: 'reduce' })
    await reduced.locator('[data-block="rich-text"]').waitFor()
    expect(await tokens(reduced)).toEqual(['1ms', '1ms', '1ms'])
  })

  it('is read-only for a role that may read the page and not change it', async () => {
    const role = (await strapi
      .service('admin::role')
      .create({ name: 'Builder reader', code: 'builder-reader' })) as { id: number }
    await strapi.service('admin::role').addPermissions(role.id, [
      { action: 'plugin::micelio.preview', subject: null, conditions: [], properties: {} },
      {
        action: 'plugin::content-manager.explorer.read',
        subject: LANDING_UID,
        conditions: [],
        properties: { fields: ['title', 'sections', 'site'], locales: ['en'] },
      },
      {
        action: 'plugin::content-manager.explorer.read',
        subject: 'plugin::micelio.site',
        conditions: [],
        properties: {
          fields: Object.keys(strapi.contentType(SITE_UID as UID.ContentType).attributes),
          locales: ['en'],
        },
      },
    ])
    const previous = superAdminId
    superAdminId = role.id
    try {
      const documentId = await newLanding([{ __component: 'section.rich-text', body: 'One' }])
      const page = await open(builderPath(documentId))
      await page.getByText('the builder is read-only').waitFor()
      expect(await page.locator('[data-block="rich-text"]').getAttribute('aria-disabled')).toBe(
        'true'
      )
      await page.locator('[data-block="rich-text"]').click({ force: true })
      await page.waitForTimeout(1500)
      expect((await sectionsOf(documentId)).length).toBe(1)
    } finally {
      superAdminId = previous
    }
  })
})
