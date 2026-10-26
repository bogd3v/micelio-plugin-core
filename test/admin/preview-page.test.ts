import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright'
import en from '../../admin/src/translations/en.json'
import es from '../../admin/src/translations/es.json'
import { PREVIEW_PERMISSION } from '../../server/src/constants/preview'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'
import { startPreviewSite, type PreviewSite } from '../strapi/preview-site'

const PAGE_UID = 'api::page.page'
const PASSWORD = 'Password1234'
const EMAIL = 'admin@example.com'
const SPANISH_EMAIL = 'admin-es@example.com'
const READER_EMAIL = 'reader@example.com'
// What the admin sandbox attribute of the frame must be (ADR-0019, section 5).
const SANDBOX = 'allow-scripts allow-same-origin allow-forms'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']
// A 1×1 PNG, the poster of the scene.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

/** `expect.poll` with the time a frame takes to load and swap in. */
const eventually = <T>(read: () => Promise<T> | T) => expect.poll(read, { timeout: 15_000 })

const text = (messages: Record<string, string>, id: string, values: Record<string, string> = {}) =>
  Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, value),
    messages[id] ?? id
  )

describe('the preview page in the admin', () => {
  let strapi: Core.Strapi
  let base: string
  let site: PreviewSite
  let browser: Browser
  let documentId: string
  const contexts: BrowserContext[] = []

  const previewPath = () => `${base}/admin/plugins/micelio/preview/${PAGE_UID}/${documentId}`

  /** A logged-in page of a context of its own; the stub site is let through the admin's CSP unless asked not to. */
  async function open(
    email?: string,
    options: {
      bypassCSP?: boolean
      reducedMotion?: 'reduce' | 'no-preference'
      /** Runs once the admin user is logged in, before the preview page opens. */
      beforePreview?: (page: Page) => Promise<void>
    } = {}
  ): Promise<Page> {
    // The token route is rate limited for each admin user: a page gets one of its own.
    email ??= await newSuperAdmin()
    const context = await browser.newContext({
      // Wide enough for the tablet width to fit in the column beside the entry.
      viewport: { width: 1920, height: 1080 },
      bypassCSP: options.bypassCSP ?? true,
      reducedMotion: options.reducedMotion ?? 'no-preference',
    })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto(`${base}/admin/auth/login`)
    await page.locator('input[name="email"]').fill(email)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL(/\/admin(?!\/auth)/)
    await options.beforePreview?.(page)
    await page.goto(previewPath())
    return page
  }

  // The newest frame: while a new render loads, the old one is still in view under it.
  const frameOf = (page: Page) => page.frameLocator('main iframe >> nth=-1')

  // One login for the suite: the login route is rate limited.
  let editorToken: string | undefined
  async function saveDraft(title: string, locale = 'en'): Promise<void> {
    if (!editorToken) {
      const login = await fetch(`${base}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      })
      const { data } = (await login.json()) as { data: { token: string } }
      editorToken = data.token
    }
    // The request the Content Manager's form makes when an editor saves.
    const saved = await fetch(
      `${base}/content-manager/collection-types/${PAGE_UID}/${documentId}?locale=${locale}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${editorToken}` },
        body: JSON.stringify({ title }),
      }
    )
    expect(saved.status).toBe(200)
  }

  async function violationsOf(page: Page): Promise<unknown[]> {
    const results = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
    return results.violations.flatMap(({ id, nodes }) =>
      nodes.map(({ target, failureSummary }) => ({ id, target, failureSummary }))
    )
  }

  async function upload(name: string, mimetype: string, bytes: Buffer): Promise<number> {
    const filepath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'micelio-preview-')), name)
    fs.writeFileSync(filepath, bytes)
    const [file] = (await strapi
      .plugin('upload')
      .service('upload')
      .upload({
        data: { fileInfo: { name, alternativeText: `Alt of ${name}` } },
        files: { filepath, originalFilename: name, mimetype, size: bytes.length },
      })) as { id: number }[]
    return file!.id
  }

  async function createUser(email: string, roleId: number, preferedLanguage: string | null) {
    await strapi.service('admin::user').create({
      email,
      firstname: 'Admin',
      lastname: 'Test',
      password: PASSWORD,
      roles: [roleId],
      isActive: true,
      preferedLanguage,
    })
  }

  let admins = 0
  let superAdminId = 0
  async function newSuperAdmin(): Promise<string> {
    admins += 1
    const email = `admin-${admins}@example.com`
    await createUser(email, superAdminId, null)
    return email
  }

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    site = await startPreviewSite()
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    const defaultSite = (await sites.findFirst()) as { documentId: string }
    await sites.update({ documentId: defaultSite.documentId, data: { url: site.origin } as never })
    const apiToken = (await strapi.service('admin::api-token').create({
      name: 'preview-pane-test',
      type: 'custom',
      lifespan: null,
      permissions: ['plugin::micelio.preview.exchange', 'plugin::micelio.preview.draft'],
    })) as { accessKey: string }
    site.connect({ base, apiToken: apiToken.accessKey, adminOrigin: base })

    // The "landing": a page with a text section and a scene, a heavy island whose poster is its
    // static alternative (the dev stack of compose.dev.yml seeds the same).
    await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' })
    const pages = strapi.documents(PAGE_UID as UID.ContentType)
    const created = await pages.create({
      locale: 'en',
      data: {
        title: 'Landing',
        slug: 'landing',
        site: defaultSite.documentId,
        sections: [
          { __component: 'section.rich-text', body: 'Welcome to the landing.' },
          {
            __component: 'section.scene',
            variant: 'inline',
            model: await upload('scene.glb', 'model/gltf-binary', Buffer.from('glTF')),
            poster: await upload('poster.png', 'image/png', PNG),
            alt: 'A spinning globe',
            title: 'Globe',
          },
        ],
      } as never,
    })
    documentId = created.documentId
    // The Spanish version is written straight to the database: the Document Service cannot connect a
    // site that has no `es` version, and a site-scoped entry without a site is not previewable.
    const siteRow = (await strapi.db
      .query(SITE_UID)
      .findOne({ where: { documentId: defaultSite.documentId } })) as { id: number }
    await strapi.db.query(PAGE_UID).create({
      data: {
        documentId,
        locale: 'es',
        title: 'Página de inicio',
        slug: 'inicio',
        publishedAt: null,
        site: siteRow.id,
      },
    })

    const superAdmin = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    superAdminId = superAdmin.id
    await createUser(EMAIL, superAdmin.id, null)
    await createUser(SPANISH_EMAIL, superAdmin.id, 'es')
    // A role that may preview and read pages, and not edit them.
    const reader = (await strapi
      .service('admin::role')
      .create({ name: 'Reader', code: 'reader' })) as { id: number }
    await strapi.service('admin::role').addPermissions(reader.id, [
      { action: PREVIEW_PERMISSION, subject: null, conditions: [], properties: {} },
      {
        action: 'plugin::content-manager.explorer.read',
        subject: PAGE_UID,
        conditions: [],
        properties: { fields: ['title', 'slug', 'sections', 'site'], locales: ['en', 'es'] },
      },
    ])
    await createUser(READER_EMAIL, reader.id, null)

    browser = await chromium.launch()
  })

  // A page left open polls the entry and reloads its frame on a save, which the next test would count.
  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close()
  })

  afterAll(async () => {
    await browser?.close()
    await site?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
  })

  it('opens the landing, loads its draft in a sandboxed frame and keeps the token off the page', async () => {
    const page = await open()
    const frame = frameOf(page)
    await expect(frame.getByRole('heading', { level: 1 }).textContent()).resolves.toBe('Landing')
    await expect(frame.locator('[data-island="scene"]').count()).resolves.toBe(1)
    await expect(page.locator('iframe[title^="Preview of"]').getAttribute('sandbox')).resolves.toBe(
      SANDBOX
    )
    expect(site.exchanges).toBeGreaterThan(0)
    // The frame ends on the draft route, not on `/_preview?token=…`.
    const urls = page.frames().map((candidate) => candidate.url())
    expect(urls.some((url) => url.startsWith(`${site.origin}/drafts/pages/${documentId}`))).toBe(
      true
    )
    expect(urls.filter((url) => url.includes('token='))).toEqual([])
    await expect(violationsOf(page)).resolves.toEqual([])
  })

  it('switches to the static site and shows the alternative of the island, keeping one frame', async () => {
    const page = await open()
    await frameOf(page).locator('[data-island="scene"]').waitFor()
    await page.getByLabel('As static site').check()
    const alternative = frameOf(page).locator('[data-static-alternative] img')
    await expect(alternative.getAttribute('alt')).resolves.toBe('A spinning globe')
    await expect(frameOf(page).locator('[data-island]').count()).resolves.toBe(0)
    // The old frame leaves once the new one is in view.
    await eventually(() => page.locator('iframe[title^="Preview of"]').count()).toBe(1)
    await expect(violationsOf(page)).resolves.toEqual([])
    await page.getByLabel('As static site').uncheck()
    await frameOf(page).locator('[data-island="scene"]').waitFor()
  })

  it('reloads the preview once when the draft is saved, without asking for a new token', async () => {
    const page = await open()
    await frameOf(page).locator('[data-island="scene"]').waitFor()
    const loads = site.draftLoads
    const exchanges = site.exchanges
    await saveDraft('Landing, saved')
    await eventually(() => frameOf(page).getByRole('heading', { level: 1 }).textContent()).toBe(
      'Landing, saved'
    )
    // Read the entry once more and wait for the answer: a second reload would have started by then.
    const read = page.waitForResponse((response) =>
      response.url().includes(`/content-manager/collection-types/${PAGE_UID}/${documentId}`)
    )
    await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    await read
    await page.evaluate('new Promise((resolve) => requestAnimationFrame(resolve))')
    expect(site.draftLoads - loads).toBe(1)
    expect(site.exchanges).toBe(exchanges)
    await saveDraft('Landing')
  })

  it('reloads once on the first save after a switch of locale', async () => {
    const page = await open()
    const heading = () => frameOf(page).getByRole('heading', { level: 1 }).textContent()
    await frameOf(page).locator('[data-island="scene"]').waitFor()
    try {
      // A save before the switch, so the page has handled one: the count of the other locale starts at 0.
      await saveDraft('Landing, saved')
      await eventually(heading).toBe('Landing, saved')
      await page.getByLabel('Locale').selectOption('es')
      await eventually(heading).toBe('Página de inicio')
      const loads = site.draftLoads
      await saveDraft('Página, guardada', 'es')
      await eventually(heading).toBe('Página, guardada')
      // Read the entry once more and wait for the answer: a second reload would have started by then.
      const read = page.waitForResponse((response) =>
        response.url().includes(`/content-manager/collection-types/${PAGE_UID}/${documentId}`)
      )
      await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
      await read
      await page.evaluate('new Promise((resolve) => requestAnimationFrame(resolve))')
      expect(site.draftLoads - loads).toBe(1)
    } finally {
      await saveDraft('Landing')
      await saveDraft('Página de inicio', 'es')
    }
  })

  it('asks for a new token and loads the frame again before the grant ends', async () => {
    // The timers of the page are the clock's, so the 14 minutes pass at once.
    const page = await open(undefined, { beforePreview: (opened) => opened.clock.install() })
    await frameOf(page).locator('[data-island="scene"]').waitFor()
    const exchanges = site.exchanges
    await page.clock.fastForward('14:05')
    await eventually(() => site.exchanges).toBe(exchanges + 1)
    await eventually(() => page.locator('main iframe').count()).toBe(1)
    await frameOf(page).locator('[data-island="scene"]').waitFor()
  })

  describe('motion', () => {
    const fadeOf = (page: Page) =>
      page.evaluate(
        'getComputedStyle(document.querySelector(\'iframe[title^="Preview of"]\')).transitionDuration'
      )

    it('cross-fades in 320 ms', async () => {
      const page = await open()
      await frameOf(page).locator('[data-island="scene"]').waitFor()
      await expect(fadeOf(page)).resolves.toBe('0.32s')
    })

    it('cross-fades in 1 ms with prefers-reduced-motion', async () => {
      const page = await open(undefined, { reducedMotion: 'reduce' })
      await frameOf(page).locator('[data-island="scene"]').waitFor()
      await expect(fadeOf(page)).resolves.toBe('0.001s')
    })
  })

  describe('the toolbar', () => {
    it('sets the width of the frame with the buttons and with the shortcuts', async () => {
      const page = await open()
      await frameOf(page).locator('[data-island="scene"]').waitFor()
      const widthOf = () =>
        page
          .locator('iframe[title^="Preview of"]')
          .evaluate((element) => element.getBoundingClientRect().width)
      await page.getByRole('button', { name: 'Phone' }).click()
      await eventually(widthOf).toBe(320)
      await page.getByRole('button', { name: 'Tablet' }).click()
      await eventually(widthOf).toBe(768)
      await page.keyboard.press('Control+Shift+Digit1')
      await expect(
        page.getByRole('button', { name: 'Phone' }).getAttribute('aria-pressed')
      ).resolves.toBe('true')
      await eventually(widthOf).toBe(320)
      await page.keyboard.press('Control+Shift+Digit3')
      await expect(
        page.getByRole('button', { name: 'Desktop' }).getAttribute('aria-pressed')
      ).resolves.toBe('true')
    })

    it('toggles the static site with its shortcut, and never inside a field', async () => {
      const page = await open()
      await frameOf(page).locator('[data-island="scene"]').waitFor()
      const toggle = page.getByLabel('As static site')
      await page.keyboard.press('Control+Shift+KeyS')
      await expect(toggle.isChecked()).resolves.toBe(true)
      await page.keyboard.press('Control+Shift+KeyS')
      await expect(toggle.isChecked()).resolves.toBe(false)
      // The locale select is a field: the keys belong to it.
      await page.getByLabel('Locale').focus()
      await page.keyboard.press('Control+Shift+KeyS')
      await page.keyboard.press('Control+Shift+Digit1')
      await expect(toggle.isChecked()).resolves.toBe(false)
      await expect(
        page.getByRole('button', { name: 'Phone' }).getAttribute('aria-pressed')
      ).resolves.toBe('false')
    })

    it('shows the other locale of the entry with a token of its own', async () => {
      const page = await open()
      await frameOf(page).locator('[data-island="scene"]').waitFor()
      const exchanges = site.exchanges
      await page.getByLabel('Locale').selectOption('es')
      await eventually(() => frameOf(page).getByRole('heading', { level: 1 }).textContent()).toBe(
        'Página de inicio'
      )
      expect(site.exchanges).toBe(exchanges + 1)
    })

    it('loads the preview again with a new token on Reload', async () => {
      const page = await open()
      await frameOf(page).locator('[data-island="scene"]').waitFor()
      const exchanges = site.exchanges
      await page.getByRole('button', { name: 'Reload' }).click()
      await eventually(() => site.exchanges).toBe(exchanges + 1)
      await eventually(() => page.locator('iframe[title^="Preview of"]').count()).toBe(1)
    })
  })

  describe('a frontend that speaks no version this plugin speaks', () => {
    it('says so, keeps a plain preview and loads it anew after a save', async () => {
      site.speaks = [2]
      try {
        const page = await open()
        await frameOf(page).locator('[data-island="scene"]').waitFor()
        const notice = page.getByRole('status').filter({ hasText: en['preview.upgrade.title'] })
        await expect(notice.textContent()).resolves.toContain('versions 2')
        const exchanges = site.exchanges
        await saveDraft('Landing, again')
        await eventually(() => frameOf(page).getByRole('heading', { level: 1 }).textContent()).toBe(
          'Landing, again'
        )
        // `load-draft` was not sent: the frame was loaded anew with a new token.
        expect(site.exchanges).toBe(exchanges + 1)
        await expect(violationsOf(page)).resolves.toEqual([])
      } finally {
        site.speaks = [1]
        await saveDraft('Landing')
      }
    })
  })

  describe('a ready that is not the frame of this page saying it has loaded this draft', () => {
    // The site speaks version 2 only, so the page shows the upgrade notice. A `ready` the page accepts
    // as a frame it can talk to (version 1) takes the notice away; one it drops leaves it in view.
    const upgradeNotice = (page: Page) =>
      page.getByRole('status').filter({ hasText: en['preview.upgrade.title'] })
    const ready = (payload: Record<string, unknown> = {}) => ({
      v: 1,
      type: 'ready',
      payload: { v: [1], documentId, locale: 'en', version: 'forged', ...payload },
    })
    const shownFrame = (page: Page) => page.mainFrame().childFrames().at(-1) as Frame

    /** Posts `message` to the page from `sender` and returns once the page has handled it and rendered. */
    async function deliver(page: Page, sender: Frame, message: unknown): Promise<void> {
      // Listeners run in the order they were added: the page's own handler is first.
      await page.evaluate(`(() => {
        window.handled = new Promise((resolve) => {
          window.addEventListener('message', function on(event) {
            if (!event.data || !event.data.barrier) return
            window.removeEventListener('message', on)
            resolve(true)
          })
        })
      })()`)
      await sender.evaluate(`(() => {
        window.parent.postMessage(${JSON.stringify(message)}, '*')
        window.parent.postMessage({ barrier: true }, '*')
      })()`)
      await page.evaluate('window.handled')
      await page.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
    }

    async function openUpgrading(): Promise<Page> {
      const page = await open()
      await frameOf(page).locator('[data-island="scene"]').waitFor()
      await upgradeNotice(page).waitFor()
      return page
    }

    beforeAll(() => {
      site.speaks = [2]
    })
    afterAll(() => {
      site.speaks = [1]
    })

    it('is taken from the frame of the page, from the site, about this draft', async () => {
      const page = await openUpgrading()
      await deliver(page, shownFrame(page), ready())
      await expect(upgradeNotice(page).count()).resolves.toBe(0)
    })

    it('is dropped when it comes from another origin', async () => {
      const page = await openUpgrading()
      await page
        .context()
        .route('http://other.test/**', (route) =>
          route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>other</title>' })
        )
      const sender = shownFrame(page)
      await sender.goto('http://other.test/')
      await deliver(page, sender, ready())
      await expect(upgradeNotice(page).count()).resolves.toBe(1)
    })

    it('is dropped when it comes from a window that is not a frame of the page', async () => {
      const page = await openUpgrading()
      // The site's own origin, in a frame the preview did not open.
      await page.evaluate(
        `new Promise((resolve) => {
          const stranger = document.createElement('iframe')
          stranger.id = 'stranger'
          stranger.src = ${JSON.stringify(`${site.origin}/stranger`)}
          stranger.onload = () => resolve(true)
          document.body.append(stranger)
        })`
      )
      const sender = page.frames().find((frame) => frame.url() === `${site.origin}/stranger`)
      expect(sender).toBeDefined()
      await deliver(page, sender as Frame, ready())
      await expect(upgradeNotice(page).count()).resolves.toBe(1)
    })

    it('is dropped when it fails the schema', async () => {
      const page = await openUpgrading()
      // No `version`: the payload is not a `ready` of the schema.
      const payload = { v: [1], documentId, locale: 'en' }
      await deliver(page, shownFrame(page), { ...ready(), payload })
      await expect(upgradeNotice(page).count()).resolves.toBe(1)
    })

    it('is dropped when it is about another document', async () => {
      const page = await openUpgrading()
      await deliver(page, shownFrame(page), ready({ documentId: 'another-document' }))
      await expect(upgradeNotice(page).count()).resolves.toBe(1)
    })

    it('is dropped when it is about another locale', async () => {
      const page = await openUpgrading()
      await deliver(page, shownFrame(page), ready({ locale: 'es' }))
      await expect(upgradeNotice(page).count()).resolves.toBe(1)
    })
  })

  describe('when the admin does not allow the site in frame-src', () => {
    it('says why the pane is empty instead of showing a broken frame', async () => {
      const page = await open(undefined, { bypassCSP: false })
      await page.getByText(en['preview.blocked.title']).waitFor()
      const origin = site.origin
      await expect(
        page.getByRole('alert').filter({ hasText: origin }).textContent()
      ).resolves.toContain('frame-src')
      await expect(page.locator('iframe[title^="Preview of"]').count()).resolves.toBe(0)
      await expect(violationsOf(page)).resolves.toEqual([])
    })
  })

  describe('an admin who may read the entry and not edit it', () => {
    it('opens it read-only, with the preview', async () => {
      const page = await open(READER_EMAIL)
      const frame = frameOf(page)
      await expect(frame.getByRole('heading', { level: 1 }).textContent()).resolves.toBe('Landing')
      await expect(
        page.getByText(en['preview.entry.readOnly'], { exact: true }).count()
      ).resolves.toBe(1)
      await expect(
        page.getByRole('link', { name: en['preview.entry.view'] }).count()
      ).resolves.toBe(1)
    })
  })

  describe('in Spanish', () => {
    async function openSpanish(): Promise<Page> {
      const spanish = await open(SPANISH_EMAIL)
      await spanish.getByRole('button', { name: es['preview.device.phone'] }).waitFor()
      return spanish
    }

    it('shows the Spanish strings and the draft', async () => {
      const spanish = await openSpanish()
      const frame = spanish.frameLocator(
        `iframe[title^="${es['preview.frame.title'].split('{')[0]}"]`
      )
      await expect(frame.getByRole('heading', { level: 1 }).textContent()).resolves.toBe('Landing')
      const main = spanish.getByRole('main')
      const shown = (await main.textContent()) ?? ''
      for (const id of [
        'preview.static',
        'preview.reload',
        'preview.entry.open',
        'preview.device.desktop',
      ]) {
        expect(shown, id).toContain(text(es, id))
      }
      // No English string of the page that has a Spanish one.
      for (const id of ['preview.static', 'preview.reload', 'preview.entry.open']) {
        expect(shown, id).not.toContain(text(en, id))
      }
    })

    it('has no WCAG 2.2 A or AA violation', async () => {
      const spanish = await openSpanish()
      await frameOf(spanish).locator('[data-island="scene"]').waitFor()
      await expect(violationsOf(spanish)).resolves.toEqual([])
    })
  })
})
