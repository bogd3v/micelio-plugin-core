import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { PAGE_TEMPLATE_UID } from '../../server/src/constants/page-templates'
import { SITE_UID } from '../../server/src/constants/site'
import type { PageTemplatesService } from '../../server/src/services/page-templates'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'
import { startPreviewSite, type PreviewSite } from '../strapi/preview-site'

// An editorial page with sections made with `withPageSettings` (test/strapi/app/src/api/guide/).
const GUIDE_UID = 'api::guide.guide' as UID.ContentType
const PASSWORD = 'Password1234'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

/** `expect.poll` with the time a save, a frame reload and its report take. */
const eventually = <T>(read: () => Promise<T> | T) => expect.poll(read, { timeout: 20_000 })

// The Save as template dialog and the New page gallery (#54), in the admin of the test app.
describe('page templates in the admin', () => {
  let strapi: Core.Strapi
  let base: string
  let site: PreviewSite
  let browser: Browser
  let siteDocumentId = ''
  let superAdminId = 0
  let admins = 0
  const contexts: BrowserContext[] = []
  const guides = () => strapi.documents(GUIDE_UID)
  const templates = () => strapi.documents(PAGE_TEMPLATE_UID as UID.ContentType)
  const service = () => strapi.plugin('micelio').service('pageTemplates') as PageTemplatesService

  async function newGuide(): Promise<string> {
    const created = await guides().create({
      locale: 'en',
      data: {
        title: 'Open source, in plain words',
        slug: `templates-${Math.random().toString(36).slice(2, 8)}`,
        pageType: 'landing',
        site: siteDocumentId,
        sections: [
          {
            __component: 'section.feature-grid',
            title: 'Why Micelio',
            columns: '3',
            density: 'comfortable',
            items: [{ title: 'Fast', text: 'Static first.' }],
          },
          { __component: 'section.rich-text', body: 'Open source, in plain words.' },
        ],
      } as never,
    })
    return created.documentId
  }

  async function open(path: string, roleId = superAdminId): Promise<Page> {
    admins += 1
    const email = `templates-${admins}@example.com`
    await strapi.service('admin::user').create({
      email,
      firstname: 'Admin',
      lastname: 'Test',
      password: PASSWORD,
      roles: [roleId],
      isActive: true,
    })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
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

  async function violationsOf(page: Page, selector: string): Promise<unknown[]> {
    const results = await new AxeBuilder({ page }).include(selector).withTags(WCAG_TAGS).analyze()
    return results.violations.flatMap(({ id, nodes }) =>
      nodes.map(({ target }) => ({ id, target }))
    )
  }

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    site = await startPreviewSite()
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    const defaultSite = (await sites.findFirst()) as { documentId: string }
    siteDocumentId = defaultSite.documentId
    await sites.update({ documentId: siteDocumentId, data: { url: site.origin } as never })
    const apiToken = (await strapi.service('admin::api-token').create({
      name: 'page-templates-test',
      type: 'custom',
      lifespan: null,
      permissions: ['plugin::micelio.preview.exchange', 'plugin::micelio.preview.draft'],
    })) as { accessKey: string }
    site.connect({ base, apiToken: apiToken.accessKey, adminOrigin: base })
    const superAdmin = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    superAdminId = superAdmin.id
    browser = await chromium.launch()
  })

  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close()
    await strapi.db.query(PAGE_TEMPLATE_UID as UID.ContentType).deleteMany({})
  })

  afterAll(async () => {
    await browser?.close()
    await site?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
  })

  it('saves the page as a template from the drawer, with what is kept block by block', async () => {
    const documentId = await newGuide()
    const page = await open(`${base}/admin/plugins/micelio/builder/${GUIDE_UID}/${documentId}`)
    await page.getByRole('button', { name: 'Page settings' }).click()
    await page.getByRole('button', { name: 'Save as template…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Save as template' })
    await dialog.waitFor()
    await dialog.getByText('2 blocks', { exact: false }).waitFor()
    // Save is held until the template has a name.
    await expect(dialog.getByRole('button', { name: 'Save template' }).isDisabled()).resolves.toBe(
      true
    )
    await dialog.getByLabel('Name').fill('Explainer landing')
    await dialog.getByLabel('Content of Rich text').selectOption('clear')
    await dialog.getByLabel('Rich text is fixed').check()
    await dialog.getByText('Name is unique on default').waitFor()
    // The scope is a check of its own: every site of the CMS, then back to this one.
    await dialog.getByRole('radio', { name: 'Every site of this CMS' }).click()
    await dialog.getByText('Every block is enabled on all', { exact: false }).waitFor()
    await dialog.getByRole('radio', { name: /only$/ }).click()
    await dialog.getByText('Every block is enabled on default').waitFor()
    expect(await violationsOf(page, '[role="dialog"]')).toEqual([])

    await dialog.getByRole('button', { name: 'Save template' }).click()
    await dialog.waitFor({ state: 'detached' })

    const [stored] = (await templates().findMany({})) as unknown as {
      name: string
      version: number
      blocks: { block: string; content: string; fixed: boolean }[]
    }[]
    expect(stored).toMatchObject({ name: 'Explainer landing', version: 1 })
    expect(stored.blocks.map(({ block, content, fixed }) => ({ block, content, fixed }))).toEqual([
      { block: 'feature-grid', content: 'sample', fixed: false },
      { block: 'rich-text', content: 'clear', fixed: true },
    ])
  })

  it('says a name is taken before the template is saved', async () => {
    const documentId = await newGuide()
    await service().save({
      site: { documentId: siteDocumentId, slug: 'default' },
      uid: GUIDE_UID,
      documentId,
      locale: 'en',
      name: 'Taken',
      scope: 'site',
    })
    const page = await open(`${base}/admin/plugins/micelio/builder/${GUIDE_UID}/${documentId}`)
    await page.getByRole('button', { name: 'Page settings' }).click()
    await page.getByRole('button', { name: 'Save as template…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Save as template' })
    await dialog.getByLabel('Name').fill('taken')
    await dialog.getByText('A template named taken exists on default').waitFor()
    await dialog.getByRole('button', { name: 'Save template' }).click()
    await dialog.getByRole('alert').getByText('already exists', { exact: false }).waitFor()
    expect(await templates().findMany({})).toHaveLength(1)
  })

  it('creates a page from a template in the gallery and greys its sample text in the builder', async () => {
    const source = await newGuide()
    const template = await service().save({
      site: { documentId: siteDocumentId, slug: 'default' },
      uid: GUIDE_UID,
      documentId: source,
      locale: 'en',
      name: 'Explainer landing',
      description: 'A grid and a text.',
      scope: 'site',
    })
    const page = await open(`${base}/admin/plugins/micelio/new/${encodeURIComponent(GUIDE_UID)}`)
    await page.getByRole('radio', { name: /Explainer landing/ }).waitFor()
    await expect(
      page.getByRole('radio', { name: /Explainer landing/ }).getAttribute('aria-checked')
    ).resolves.toBe('true')
    expect(await violationsOf(page, 'main')).toEqual([])

    await page.getByLabel('Title of the new page').fill('My first page')
    await page.getByRole('button', { name: 'Create from Explainer landing' }).click()
    await page.waitForURL(/\/plugins\/micelio\/builder\//)

    const [created] = (await guides().findMany({
      filters: { title: 'My first page' },
      locale: 'en',
    })) as unknown as { documentId: string; templateId: string; templateVersion: number }[]
    expect(created).toMatchObject({ templateId: template.id, templateVersion: 1 })

    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]')
      .nth(1)
      .click()
    const field = page.getByLabel('Body')
    await field.waitFor()
    await expect(field.getAttribute('data-sample')).resolves.toBe('true')
    await page.getByTestId('sample-text').waitFor()
    await field.fill('Our own words.')
    await eventually(() => page.getByTestId('sample-text').count()).toBe(0)
  })

  it('holds Save as template until the page is saved, so the template is not made from an old draft', async () => {
    const documentId = await newGuide()
    const page = await open(`${base}/admin/plugins/micelio/builder/${GUIDE_UID}/${documentId}`)
    // The save takes its time, so the drawer opens while the edit is not stored yet.
    await page.route('**/content-manager/collection-types/**', async (route) => {
      if (route.request().method() === 'PUT') await new Promise((done) => setTimeout(done, 2500))
      await route.continue()
    })
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]')
      .nth(1)
      .click()
    await page.getByLabel('Body').fill('A text that is not saved yet.')
    await page.getByRole('button', { name: 'Page settings' }).click()
    const button = page.getByRole('button', { name: 'Save as template…' })
    await expect(button.isDisabled()).resolves.toBe(true)
    await page.getByText('Wait for the page to be saved first.').waitFor()
    await eventually(() => button.isDisabled()).toBe(false)
  })

  it('exports a template as JSON and imports it again in the gallery', async () => {
    const source = await newGuide()
    const template = await service().save({
      site: { documentId: siteDocumentId, slug: 'default' },
      uid: GUIDE_UID,
      documentId: source,
      locale: 'en',
      name: 'Round trip',
      scope: 'site',
    })
    const page = await open(`${base}/admin/plugins/micelio/new/${encodeURIComponent(GUIDE_UID)}`)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export JSON: Round trip' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('round-trip.micelio-template.json')
    const exported = JSON.parse(
      await (await import('node:fs/promises')).readFile((await download.path()) as string, 'utf8')
    ) as { name: string; version: number; blocks: unknown[] }
    expect(exported).toMatchObject({ name: 'Round trip', version: 1 })

    // Its own name is taken: the notification says so and nothing is stored.
    await page.getByLabel('Import a template').setInputFiles({
      name: 'again.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(exported)),
    })
    await page.getByText('already exists', { exact: false }).first().waitFor()
    expect(await templates().findMany({})).toHaveLength(1)

    // Under another name it is stored as the same structure, and the gallery lists it.
    await page.getByLabel('Import a template').setInputFiles({
      name: 'copy.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...exported, name: 'Round trip copy' })),
    })
    await page.getByRole('radio', { name: /Round trip copy/ }).waitFor()
    expect(await templates().findMany({})).toHaveLength(2)
    expect(template.version).toBe(1)

    await page.getByLabel('Import a template').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('not json'),
    })
    await page.getByText('That file is not JSON.').first().waitFor()
  })

  it('shows the detail of a refused template export in the gallery', async () => {
    const detail = 'Your role may not export templates of this site.'
    const source = await newGuide()
    await service().save({
      site: { documentId: siteDocumentId, slug: 'default' },
      uid: GUIDE_UID,
      documentId: source,
      locale: 'en',
      name: 'Refused export',
      scope: 'site',
    })
    const page = await open(`${base}/admin/plugins/micelio/new/${encodeURIComponent(GUIDE_UID)}`)
    await page.getByRole('button', { name: 'Export JSON: Refused export' }).waitFor()
    await page.route('**/micelio/templates/*/export', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://micelio.dev/problems/templatesForbidden',
          title: 'Forbidden',
          status: 403,
          code: 'templatesForbidden',
          detail,
        }),
      })
    )
    await page.getByRole('button', { name: 'Export JSON: Refused export' }).click()
    await page.getByText(detail).waitFor()
    await expect(page.getByText('The template was not exported.').count()).resolves.toBe(0)
  })

  it('shows a role that may create pages but not manage templates no export, no import and no Save as template', async () => {
    const source = await newGuide()
    await service().save({
      site: { documentId: siteDocumentId, slug: 'default' },
      uid: GUIDE_UID,
      documentId: source,
      locale: 'en',
      name: 'For creators',
      scope: 'site',
    })
    const roles = strapi.service('admin::role')
    const role = await roles.create({ name: 'Creators', description: 'Creates guides' })
    const fields = ['title', 'slug', 'sections', 'pageType', 'visibility', 'site']
    await roles.assignPermissions(role.id, [
      ...['create', 'read', 'update'].map((verb) => ({
        action: `plugin::content-manager.explorer.${verb}`,
        subject: GUIDE_UID,
        properties: { fields, locales: ['en'] },
        conditions: [],
      })),
      {
        action: 'plugin::content-manager.explorer.read',
        subject: 'plugin::micelio.site',
        properties: { fields: ['name', 'slug'], locales: ['en'] },
        conditions: [],
      },
      { action: 'plugin::micelio.preview', subject: null, properties: {}, conditions: [] },
    ])
    const page = await open(
      `${base}/admin/plugins/micelio/new/${encodeURIComponent(GUIDE_UID)}`,
      role.id as number
    )
    await page.getByRole('radio', { name: /For creators/ }).waitFor()
    expect(await page.getByRole('button', { name: /Export JSON/ }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Import a template' }).count()).toBe(0)
    await page.getByRole('button', { name: 'Create from For creators' }).waitFor()

    // The drawer of the same role has the page's settings and no way to save it as a template.
    await page.goto(`${base}/admin/plugins/micelio/builder/${GUIDE_UID}/${source}`)
    await page.getByRole('button', { name: 'Page settings' }).click()
    await page
      .getByRole('dialog', { name: 'Page settings' })
      .getByRole('button', { name: 'Done' })
      .waitFor()
    expect(await page.getByRole('button', { name: 'Save as template…' }).count()).toBe(0)
  })

  it('offers the gallery from the create view of a page type with page settings', async () => {
    const page = await open(`${base}/admin/content-manager/collection-types/${GUIDE_UID}/create`)
    await page.getByRole('heading', { name: 'Create an entry' }).waitFor()
    await page.getByRole('button', { name: 'New page from a template…' }).click()
    // Strapi asks before it leaves a form it holds changes in (the slug fills itself in).
    await page.getByRole('button', { name: 'Confirm' }).click()
    await page.waitForURL(/\/plugins\/micelio\/new\//)
    await page.getByRole('radio', { name: /Empty page/ }).waitFor()
  })
})
