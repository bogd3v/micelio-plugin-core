import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'
import { startPreviewSite, type PreviewSite } from '../strapi/preview-site'

const PAGE_UID = 'api::page.page'
const PASSWORD = 'Password1234'
const SUITE_ADMIN = 'suite-media@example.com'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']
// A 1×1 PNG: the Media Library makes its thumbnail and reads its size from it.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

const eventually = <T>(read: () => Promise<T> | T) => expect.poll(read, { timeout: 20_000 })

interface Stored {
  id: number
  alternativeText: string | null
}

describe('the media fields of the builder panel', () => {
  let strapi: Core.Strapi
  let base: string
  let site: PreviewSite
  let browser: Browser
  let siteDocumentId = ''
  const contexts: BrowserContext[] = []
  let admins = 0
  let superAdminId = 0
  let adminToken: string | undefined

  async function token(): Promise<string> {
    if (!adminToken) {
      const login = await fetch(`${base}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: SUITE_ADMIN, password: PASSWORD }),
      })
      adminToken = ((await login.json()) as { data: { token: string } }).data.token
    }
    return adminToken
  }

  /** Puts a file in the Media Library, as an editor would from its page. */
  async function upload(name: string): Promise<Stored> {
    const form = new FormData()
    form.append('files', new Blob([PNG], { type: 'image/png' }), name)
    const response = await fetch(`${base}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token()}` },
      body: form,
    })
    expect(response.status).toBe(201)
    return ((await response.json()) as Stored[])[0]!
  }

  async function altOf(id: number): Promise<string | null> {
    const row = (await strapi.db
      .query('plugin::upload.file')
      .findOne({ where: { id } })) as Stored | null
    return row ? row.alternativeText : null
  }

  const builderPath = (documentId: string) =>
    `${base}/admin/plugins/micelio/builder/${PAGE_UID}/${documentId}`

  async function newLanding(sections: object[] = []): Promise<string> {
    const created = await strapi.documents(PAGE_UID as UID.ContentType).create({
      locale: 'en',
      data: { title: 'Built page', site: siteDocumentId, sections } as never,
    })
    return created.documentId
  }

  interface Section {
    __component: string
    id: number
    title?: string
    images?: { id: number }[]
    items?: { id: number; title: string; icon: { id: number } | null }[]
  }

  async function sectionsOf(documentId: string): Promise<Section[]> {
    const draft = (await strapi.documents(PAGE_UID as UID.ContentType).findOne({
      documentId,
      locale: 'en',
      status: 'draft',
      populate: {
        sections: {
          on: {
            'section.gallery': { populate: ['images'] },
            'section.feature-grid': { populate: { items: { populate: ['icon'] } } },
          },
        },
      } as never,
    })) as unknown as { sections: Section[] }
    return draft.sections
  }

  async function open(path: string): Promise<Page> {
    admins += 1
    const email = `media-${admins}@example.com`
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
    })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto(`${base}/admin/auth/login`)
    await page.locator('input[name="email"]').fill(email)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL(/\/admin(?!\/auth)/)
    await page.goto(path)
    return page
  }

  const frameOf = (page: Page) => page.frameLocator('main iframe >> nth=-1')
  const shown = (page: Page) =>
    frameOf(page)
      .locator('[data-myc-block]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-myc-block')))
  const panel = (page: Page) => page.getByRole('complementary', { name: 'Selected block' })

  /** Picks files in Strapi's own dialog, by name, and closes it with Finish. */
  async function pick(page: Page, ...names: string[]): Promise<void> {
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    for (const name of names) {
      await dialog.getByRole('checkbox', { name: new RegExp(`^Select ${name}|${name}`) }).check()
    }
    await dialog.getByRole('button', { name: 'Finish' }).click()
    await dialog.waitFor({ state: 'hidden' })
  }

  /** The axe run over `parts` of the page, less what `skip` matches; the admin's own menu is not ours. */
  async function violationsOf(
    page: Page,
    parts: string[],
    skip: string[] = []
  ): Promise<unknown[]> {
    let axe = new AxeBuilder({ page }).withTags(WCAG_TAGS)
    for (const selector of parts) axe = axe.include(selector)
    for (const selector of skip) axe = axe.exclude(selector)
    const results = await axe.analyze()
    return results.violations.flatMap(({ id, nodes }) =>
      nodes.map(({ target }) => ({ id, target }))
    )
  }

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    strapi.config.set('plugin::micelio.budgets', {
      ...strapi.config.get<Record<string, unknown>>('plugin::micelio.budgets'),
      contentTypes: [PAGE_UID],
    })
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    site = await startPreviewSite()
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    const defaultSite = (await sites.findFirst()) as { documentId: string }
    siteDocumentId = defaultSite.documentId
    await sites.update({ documentId: siteDocumentId, data: { url: site.origin } as never })
    const apiToken = (await strapi.service('admin::api-token').create({
      name: 'builder-media-test',
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

  it('inserts a gallery, picks two images, reorders them and removes one', async () => {
    const [first, second] = [await upload('one.png'), await upload('two.png')]
    const documentId = await newLanding()
    const page = await open(builderPath(documentId))
    await page.locator('[data-block="gallery"]').waitFor()
    await page.locator('[data-block="gallery"]').click()
    await page.getByRole('button', { name: '+ Add files' }).click()
    await pick(page, 'one.png', 'two.png')
    await eventually(async () => (await sectionsOf(documentId)).map((s) => s.__component)).toEqual([
      'section.gallery',
    ])
    await eventually(async () =>
      (await sectionsOf(documentId))[0]?.images?.map((i) => i.id)
    ).toEqual([first.id, second.id])
    // The preview shows the files after the autosave.
    await eventually(() => frameOf(page).locator('[data-section="gallery"] img').count()).toBe(2)

    // Reorder: the first goes below the second; then remove the one that is now first.
    await panel(page).getByRole('button', { name: 'Move one.png down' }).click()
    await eventually(async () =>
      (await sectionsOf(documentId))[0]?.images?.map((i) => i.id)
    ).toEqual([second.id, first.id])
    await panel(page).getByRole('button', { name: 'Remove two.png' }).click()
    await eventually(async () =>
      (await sectionsOf(documentId))[0]?.images?.map((i) => i.id)
    ).toEqual([first.id])
    await eventually(() => frameOf(page).locator('[data-section="gallery"] img').count()).toBe(1)
    expect(await shown(page)).toEqual(['gallery'])
  })

  it('holds the save of a gallery with no image, with the toolbar message, until it has one', async () => {
    const image = await upload('only.png')
    const documentId = await newLanding()
    const page = await open(builderPath(documentId))
    await page.locator('[data-block="gallery"]').click()
    await page.getByText('Not saved: a required field is empty').waitFor()
    await panel(page).getByText('A file is required').waitFor()
    // Nothing was sent: the page holds no gallery, a second after the insert.
    await page.waitForTimeout(1500)
    expect(await sectionsOf(documentId)).toEqual([])

    await page.getByRole('button', { name: '+ Add files' }).click()
    await pick(page, 'only.png')
    await eventually(async () =>
      (await sectionsOf(documentId))[0]?.images?.map((i) => i.id)
    ).toEqual([image.id])
    await page.getByText('Not saved: a required field is empty').waitFor({ state: 'hidden' })
  })

  it('replaces an item’s icon keeping its other fields and id, and undoes it', async () => {
    const [old, fresh] = [await upload('old-icon.png'), await upload('new-icon.png')]
    const documentId = await newLanding([
      {
        __component: 'section.feature-grid',
        title: 'Grid',
        items: [{ title: 'Read it', icon: old.id }],
      },
    ])
    const before = (await sectionsOf(documentId))[0]!.items![0]!
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['feature-grid'])
    await frameOf(page).locator('[data-myc-index="0"]').click()
    await panel(page)
      .getByRole('button', { name: /Item 1/ })
      .click()
    await panel(page).getByRole('button', { name: 'Replace old-icon.png' }).click()
    await pick(page, 'new-icon.png')
    await eventually(async () => (await sectionsOf(documentId))[0]?.items?.[0]?.icon?.id).toBe(
      fresh.id
    )
    const after = (await sectionsOf(documentId))[0]!.items![0]!
    expect([after.id, after.title]).toEqual([before.id, 'Read it'])
    await eventually(() => frameOf(page).locator('[data-icon]').getAttribute('src')).toContain(
      'new_icon'
    )

    await page.getByRole('button', { name: 'Undo' }).click()
    await eventually(async () => (await sectionsOf(documentId))[0]?.items?.[0]?.icon?.id).toBe(
      old.id
    )
    const undone = (await sectionsOf(documentId))[0]!.items![0]!
    expect([undone.id, undone.title]).toEqual([before.id, 'Read it'])
  })

  it('edits the alternative text where Strapi keeps it, and marks a file decorative', async () => {
    const image = await upload('alt.png')
    const documentId = await newLanding([
      { __component: 'section.gallery', title: 'Pictures', images: [image.id] },
    ])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['gallery'])
    await frameOf(page).locator('[data-myc-index="0"]').click()
    const alt = panel(page).getByLabel('Alternative text')
    await panel(page).getByText('Required by the accessibility check').waitFor()
    await alt.fill('A grey pixel')
    await alt.blur()
    await eventually(() => altOf(image.id)).toBe('A grey pixel')
    // The preview shows the new text after the autosave the change causes.
    await eventually(() =>
      frameOf(page).locator('[data-section="gallery"] img').getAttribute('alt')
    ).toBe('A grey pixel')
    await panel(page).getByLabel('Decorative, no text needed').click()
    await eventually(() => altOf(image.id)).toBe('')
    expect(await alt.isDisabled()).toBe(true)
    // A file’s alternative text is not a step: nothing to undo yet.
    expect(await page.getByRole('button', { name: 'Undo' }).count()).toBe(0)
  })

  it('has no axe violation with a media field selected and the dialog open', async () => {
    const image = await upload('axe.png')
    const documentId = await newLanding([
      { __component: 'section.gallery', title: 'Pictures', images: [image.id] },
    ])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['gallery'])
    await frameOf(page).locator('[data-myc-index="0"]').click()
    await panel(page).getByLabel('Alternative text').waitFor()
    expect(await violationsOf(page, ['main'])).toEqual([])
    await page.getByRole('button', { name: '+ Add files' }).click()
    await page.getByRole('dialog').waitFor()
    // The dialog is Strapi's. Its asset cards (`article`) break `label-content-name-mismatch`
    // and `nested-interactive`; the maintainer accepted both (#133). Any other rule, or a node
    // outside the cards, is new and fails here; the page under the dialog has none.
    expect(await violationsOf(page, ['main'])).toEqual([])
    const theirs = (await violationsOf(page, ['[role="dialog"]'])) as {
      id: string
      target: string[]
    }[]
    const known = ['label-content-name-mismatch', 'nested-interactive']
    expect(theirs.filter(({ id }) => !known.includes(id))).toEqual([])
    expect(theirs.filter(({ target }) => !target.join(' ').startsWith('article'))).toEqual([])
  })

  it('keeps the files of the page through keep my version', async () => {
    const [first, second] = [await upload('keep-a.png'), await upload('keep-b.png')]
    const documentId = await newLanding([
      { __component: 'section.gallery', title: 'Pictures', images: [first.id, second.id] },
    ])
    const page = await open(builderPath(documentId))
    await eventually(() => shown(page)).toEqual(['gallery'])
    await frameOf(page).locator('[data-myc-index="0"]').click()
    // Another session saves the page first (the Content Manager’s route).
    const other = await fetch(
      `${base}/content-manager/collection-types/${PAGE_UID}/${documentId}?locale=en`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ title: 'Saved elsewhere' }),
      }
    )
    expect(other.status).toBe(200)
    await panel(page).getByRole('button', { name: 'Move keep-a.png down' }).click()
    await page.getByText('This page was saved somewhere else').waitFor()
    await page.getByRole('button', { name: 'Keep my version' }).click()
    await eventually(async () =>
      (await sectionsOf(documentId))[0]?.images?.map((i) => i.id)
    ).toEqual([second.id, first.id])
  })
})
