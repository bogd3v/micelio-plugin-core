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
    options: { theme?: 'dark'; width?: number; recordRuns?: boolean } = {}
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
    if (options.recordRuns) await recordRuns(context)
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

  // The `micelio:run` messages the frames of a page got, kept in the stub origin's session storage so
  // a reload of the frame (after a save) does not lose them.
  async function recordRuns(context: BrowserContext): Promise<void> {
    // A string: the suites' tsconfig has no DOM types.
    await context.addInitScript(`addEventListener('message', (event) => {
      if (event.data?.type !== 'micelio:run') return
      const list = JSON.parse(sessionStorage.getItem('runs') ?? '[]')
      list.push(event.data)
      sessionStorage.setItem('runs', JSON.stringify(list))
    })`)
  }
  // Runs a script in the stub's frame in view (the last one, as `frameOf` reads).
  const inFrame = (page: Page, script: string) =>
    page
      .frames()
      .filter((frame) => frame.url().startsWith(site.origin))
      .at(-1)!
      .evaluate(script)
  const runsOf = async (page: Page) =>
    JSON.parse(String(await inFrame(page, "sessionStorage.getItem('runs') ?? '[]'"))) as {
      payload: { requestId: string; address: Record<string, unknown> }
    }[]

  // The seeded page with the Scene's `model`, which it requires: without it the page is never saved.
  async function savableShowcase(playground: object = {}): Promise<string> {
    const model = (await strapi.db.query('plugin::upload.file').create({
      data: {
        name: 'run.glb',
        hash: `run_glb_${admins}`,
        ext: '.glb',
        mime: 'model/gltf-binary',
        size: 1,
        url: '/uploads/run.glb',
        provider: 'local',
      },
    })) as { id: number }
    const [text, scene, code] = SECTIONS as [object, object, object]
    return newShowcase([text, { ...scene, model: model.id }, { ...code, ...playground }])
  }

  async function selectPlayground(page: Page): Promise<void> {
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]', { hasText: 'Playground' })
      .click()
    await page.getByLabel('Expected output').waitFor()
  }
  const runButton = (page: Page) =>
    page.getByRole('button', { name: 'Run here and fill expected output' })

  async function saved(
    documentId: string
  ): Promise<{ updatedAt: string; playground: Record<string, unknown> }> {
    const found = (await strapi.documents(SHOWCASE_UID as UID.ContentType).findOne({
      documentId,
      locale: 'en',
      populate: { sections: { populate: '*' } },
    } as never)) as unknown as { updatedAt: string; sections: Record<string, unknown>[] }
    const playground = found.sections.find((section) => section.__component === 'shared.playground')
    return { updatedAt: String(found.updatedAt), playground: playground ?? {} }
  }

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

    // A Playground's expected output is its alternative: marked required, and the frame can run it.
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]', { hasText: 'Playground' })
      .click()
    await eventually(() => page.getByTestId('alternative-missing').textContent()).toContain(
      'Required before the page goes to review'
    )
    expect(await page.getByLabel('Expected output').count()).toBe(1)
    await eventually(() =>
      page.getByRole('button', { name: 'Run here and fill expected output' }).isEnabled()
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
    // The Scene's `model` is required and not part of its static alternative, so it holds the save.
    const model = (await strapi.db.query('plugin::upload.file').create({
      data: {
        name: 'hyphae.glb',
        hash: 'hyphae_glb',
        ext: '.glb',
        mime: 'model/gltf-binary',
        size: 1,
        url: '/uploads/hyphae.glb',
        provider: 'local',
      },
    })) as { id: number }
    const [text, scene, playground] = SECTIONS as [object, object, object]
    const page = await open(await newShowcase([text, { ...scene, model: model.id }, playground]))
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

  it("Run here fills Expected output with the frame's answer after the autosave", async () => {
    const documentId = await savableShowcase()
    const page = await open(documentId, { recordRuns: true })
    await selectPlayground(page)
    const field = page.getByLabel('Expected output')
    expect(await field.inputValue()).toBe('')

    await eventually(() => runButton(page).isEnabled()).toBe(true)
    await runButton(page).click()
    // The frame ran the block as the draft holds it, and its output is the field's value.
    await eventually(() => field.inputValue()).toBe('ran: print(1)')
    expect(await page.getByTestId('run-status').textContent()).toBe(
      'Expected output filled from the run.'
    )
    // The message named the block and nothing else: no code, language or setup.
    const [run, ...more] = await runsOf(page)
    expect(more).toEqual([])
    expect(Object.keys(run!.payload).sort()).toEqual(['address', 'requestId'])
    expect(run!.payload.address).toEqual({
      zone: 'sections',
      index: 2,
      block: 'playground',
      version: expect.any(String),
    })

    // The output is an edit like any other: the autosave saves it, and the field stays editable.
    await eventually(async () => (await saved(documentId)).playground.expectedOutput).toBe(
      'ran: print(1)'
    )
    expect(await field.isEditable()).toBe(true)

    // Undo takes it back, and the autosave saves the old value again.
    site.run = { kind: 'answer', truncated: true }
    try {
      await page.getByRole('button', { name: 'Undo' }).click()
      await eventually(() => field.inputValue()).toBe('')
      await eventually(async () => (await saved(documentId)).playground.expectedOutput ?? '').toBe(
        ''
      )

      // An output the frame cut at 64 KB fills the field too, and the panel says it was cut.
      await eventually(() => runButton(page).isEnabled()).toBe(true)
      await runButton(page).click()
      await eventually(() => page.getByTestId('run-status').textContent()).toBe(
        'Expected output filled from the run. The output was cut at 64 KB.'
      )
      expect(await field.inputValue()).toBe('ran: print(1)')
    } finally {
      site.run = { kind: 'answer' }
    }
  })

  it('Run here leaves Expected output unchanged and shows the reason when the frame answers an error', async () => {
    const documentId = await savableShowcase({ expectedOutput: 'kept' })
    // The error a reader would see, with markup in it: the panel shows it as text.
    site.run = { kind: 'error', reason: 'codeError', output: '<b>NameError</b>: flow' }
    try {
      const page = await open(documentId)
      await selectPlayground(page)
      const before = await saved(documentId)
      await eventually(() => runButton(page).isEnabled()).toBe(true)
      await runButton(page).click()

      const error = page.getByTestId('run-error')
      await eventually(() => error.isVisible()).toBe(true)
      expect(await error.getAttribute('role')).toBe('alert')
      expect(await error.textContent()).toContain(
        'The code failed, so Expected output was not changed.'
      )
      const output = page.getByTestId('run-error-output')
      expect(await output.textContent()).toBe('<b>NameError</b>: flow')
      expect(await output.locator('b').count()).toBe(0)
      expect(await page.getByLabel('Expected output').inputValue()).toBe('kept')
      // Nothing was edited, so nothing was saved.
      expect(await page.getByTestId('run-status').textContent()).toBe('')
      expect(await saved(documentId)).toEqual(before)
      await eventually(() => runButton(page).isEnabled()).toBe(true)

      // A frame that never says `ready` cannot be asked: the button says why it waits.
      site.isSilent = true
      const quiet = await open(documentId)
      await selectPlayground(quiet)
      expect(await runButton(quiet).isDisabled()).toBe(true)
      expect(await quiet.getByTestId('run-here').textContent()).toContain(
        'The code runs in the preview, and no preview has loaded the page here.'
      )
      site.isSilent = false

      // A role that may read the page and not change it cannot fill the field: no run either.
      const role = (await strapi
        .service('admin::role')
        .create({ name: 'Showcase reader', code: 'showcase-reader' })) as { id: number }
      await strapi.service('admin::role').addPermissions(role.id, [
        { action: 'plugin::micelio.preview', subject: null, conditions: [], properties: {} },
        {
          action: 'plugin::content-manager.explorer.read',
          subject: SHOWCASE_UID,
          conditions: [],
          properties: { fields: ['title', 'sections', 'site'], locales: ['en'] },
        },
        {
          action: 'plugin::content-manager.explorer.read',
          subject: SITE_UID,
          conditions: [],
          properties: {
            fields: Object.keys(strapi.contentType(SITE_UID as UID.ContentType).attributes),
            locales: ['en'],
          },
        },
      ])
      const admin = superAdminId
      superAdminId = role.id
      try {
        const reader = await open(documentId)
        await reader.getByText('the builder is read-only').waitFor()
        await selectPlayground(reader)
        await eventually(() => reader.getByTestId('run-here').textContent()).toContain(
          'The preview runs the saved code'
        )
        expect(await runButton(reader).isDisabled()).toBe(true)
      } finally {
        superAdminId = admin
      }
    } finally {
      site.run = { kind: 'answer' }
      site.isSilent = false
    }
  })

  it('Run here waits for the autosave of an unsaved edit before it asks the frame', async () => {
    const documentId = await savableShowcase()
    const page = await open(documentId, { recordRuns: true })
    await selectPlayground(page)
    const first = (await saved(documentId)).updatedAt
    await eventually(() => runButton(page).isEnabled()).toBe(true)

    // An edit of the code, not saved yet, and the run at once: it waits, the page saves, and the
    // frame runs the code it loads after that save.
    await page.getByLabel('Code').fill('print(2)')
    await runButton(page).click()
    await eventually(() => page.getByLabel('Expected output').inputValue()).toBe('ran: print(2)')

    // One message, to the frame that shows the saved edit: none went to the frame of the old draft.
    const runs = await runsOf(page)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.payload.address.version).not.toBe(first)
    await eventually(async () => (await saved(documentId)).playground).toMatchObject({
      code: 'print(2)',
      expectedOutput: 'ran: print(2)',
    })

    // A save the page holds (the Scene lacks its required model): the run does not start.
    const held = await open(await newShowcase(), { recordRuns: true })
    await selectPlayground(held)
    await eventually(() => runButton(held).isEnabled()).toBe(true)
    await held.getByLabel('Code').fill('print(3)')
    await runButton(held).click()
    await eventually(() => held.getByTestId('run-error').textContent()).toContain(
      'The run did not start'
    )
    expect(await held.getByLabel('Expected output').inputValue()).toBe('')
    expect(await runsOf(held)).toEqual([])

    // A frame that does not show the saved page within 70 seconds ends the wait the same way.
    const slowId = await savableShowcase()
    const slow = await open(slowId, { recordRuns: true })
    await selectPlayground(slow)
    await eventually(() => runButton(slow).isEnabled()).toBe(true)
    site.isSilent = true
    try {
      await slow.clock.install()
      const loads = site.draftLoads
      await slow.getByLabel('Code').fill('print(4)')
      await runButton(slow).click()
      expect(await slow.getByTestId('run-status').textContent()).toBe(
        'Saving the page before the run…'
      )
      // The page saved, and the frame loaded it and said nothing.
      await eventually(async () => (await saved(slowId)).playground.code).toBe('print(4)')
      await eventually(() => site.draftLoads).toBeGreaterThan(loads)
      expect(await slow.getByTestId('run-status').textContent()).toBe(
        'Saving the page before the run…'
      )
      await slow.clock.fastForward(70_000)
      await eventually(() => slow.getByTestId('run-error').textContent()).toContain(
        'The run did not start'
      )
      expect(await runsOf(slow)).toEqual([])
    } finally {
      site.isSilent = false
    }
  })

  it('Run here fails a run when the frame says ready again or no answer comes within 70 seconds', async () => {
    const documentId = await savableShowcase({ expectedOutput: 'kept' })
    // A frame that takes the message and never answers.
    site.run = { kind: 'silent' }
    try {
      const page = await open(documentId, { recordRuns: true })
      await selectPlayground(page)
      const field = page.getByLabel('Expected output')
      const error = page.getByTestId('run-error')
      await eventually(() => runButton(page).isEnabled()).toBe(true)

      // The frame loads again while the run is open: the run fails, and is not sent again.
      await runButton(page).click()
      await eventually(() => page.getByTestId('run-status').textContent()).toBe(
        'Running in the preview…'
      )
      expect(await runButton(page).isDisabled()).toBe(true)
      await eventually(async () => (await runsOf(page)).length).toBe(1)
      await inFrame(page, 'location.reload()')
      await eventually(() => error.textContent()).toContain(
        'The preview could not load the runtime, or it loaded the page again before the run ended.'
      )
      expect(await field.inputValue()).toBe('kept')
      expect(await runsOf(page)).toHaveLength(1)

      // No answer within 70 seconds: the run fails, on the page's clock.
      await page.clock.install()
      await eventually(() => runButton(page).isEnabled()).toBe(true)
      await runButton(page).click()
      await eventually(async () => (await runsOf(page)).length).toBe(2)
      await eventually(() => page.getByTestId('run-status').textContent()).toBe(
        'Running in the preview…'
      )
      await page.clock.fastForward(69_000)
      expect(await page.getByTestId('run-status').textContent()).toBe('Running in the preview…')
      await page.clock.fastForward(1_000)
      await eventually(() => error.textContent()).toContain(
        'The preview did not answer within 70 seconds'
      )

      // An answer to the run the admin gave up on is dropped. A click in the frame after it shows
      // when the admin has read it: the frame's messages arrive in order.
      const late = (await runsOf(page))[1]!.payload
      const answer = {
        v: 1,
        type: 'micelio:runResult',
        payload: { ...late, ok: true, output: 'late', truncated: false },
      }
      await inFrame(page, `parent.postMessage(${JSON.stringify(answer)}, '*')`)
      await frameOf(page).locator('[data-section="scene"]').click()
      await eventually(() => page.getByTestId('selection-label').textContent()).toBe(
        'Scene · 3D island · 2 of 3'
      )
      await selectPlayground(page)
      expect(await field.inputValue()).toBe('kept')
      expect(await error.textContent()).toContain('The preview did not answer within 70 seconds')
    } finally {
      site.run = { kind: 'answer' }
    }
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
