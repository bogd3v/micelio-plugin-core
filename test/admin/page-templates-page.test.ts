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

// The Page templates page, the template editor and the Template tab of the page settings (#55), in
// the admin of the test app.
describe('page templates page and Template tab', () => {
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
    const email = `manage-${admins}@example.com`
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
      name: 'page-templates-page-test',
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

  const siteRef = () => ({ documentId: siteDocumentId, slug: 'default' })

  /** A template saved from a new guide: the grid fixed, the text and the second block free. */
  async function newTemplate(name: string, fixed = [true, false]) {
    return service().save({
      site: siteRef(),
      uid: GUIDE_UID,
      documentId: await newGuide(),
      locale: 'en',
      name,
      scope: 'site',
      pageTypes: ['landing'],
      blocks: fixed.map((isFixed) => ({ content: 'sample' as const, fixed: isFixed })),
    })
  }

  const pageFrom = (id: string, title: string) =>
    service().createPage(id, { uid: GUIDE_UID, site: siteRef(), locale: 'en', title })

  it('usage counts match the pages created in the suite', async () => {
    const busy = await newTemplate('Busy template')
    const quiet = await newTemplate('Quiet template')
    await newTemplate('Unused template')
    for (const title of ['First page', 'Second page', 'Third page']) await pageFrom(busy.id, title)
    await pageFrom(quiet.id, 'Only page')

    const page = await open(`${base}/admin/plugins/micelio/templates`)
    const row = (name: string) => page.getByRole('row', { name: new RegExp(name) })
    await row('Busy template').waitFor()
    await expect(row('Busy template').textContent()).resolves.toContain('3 pages')
    await expect(row('Quiet template').textContent()).resolves.toContain('1 page')
    await expect(row('Unused template').textContent()).resolves.toContain('0 pages')

    // The panel of the selected template lists the pages made from it, with the version they started from.
    await row('Busy template').getByRole('button').click()
    const panel = page.getByRole('complementary', { name: 'Template Busy template' })
    for (const title of ['First page', 'Second page', 'Third page']) {
      await panel.getByRole('link', { name: title }).waitFor()
    }
    await expect(panel.getByText('v1 · draft').count()).resolves.toBe(3)
    await panel.getByText('Structure').waitFor()
    await panel.getByText(/created from “/).waitFor()
    expect(await violationsOf(page, 'main')).toEqual([])
  })

  it('duplicates, retires and restores a template, and exports its JSON', async () => {
    const template = await newTemplate('Keeper')
    const page = await open(`${base}/admin/plugins/micelio/templates`)
    const panel = page.getByRole('complementary', { name: 'Template Keeper' })
    await panel.waitFor()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      panel.getByRole('button', { name: 'Export JSON' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('keeper.micelio-template.json')

    await panel.getByRole('button', { name: 'Duplicate' }).click()
    await page.getByRole('complementary', { name: 'Template Keeper (copy)' }).waitFor()
    expect(await templates().findMany({})).toHaveLength(2)

    await page
      .getByRole('row', { name: /Keeper(?! \(copy)/ })
      .getByRole('button')
      .click()
    await page
      .getByRole('complementary', { name: 'Template Keeper' })
      .getByRole('button', { name: 'Retire' })
      .click()
    await page
      .getByRole('row', { name: /Keeper(?! \(copy)/ })
      .getByText('retired')
      .waitFor()
    const gallery = await open(`${base}/admin/plugins/micelio/new/${encodeURIComponent(GUIDE_UID)}`)
    await gallery.getByRole('radio', { name: /Keeper \(copy\)/ }).waitFor()
    expect(await gallery.getByRole('radio', { name: /^Keeper · / }).count()).toBe(0)
    const retired = (await templates().findOne({ documentId: template.id })) as unknown as {
      retired: boolean
    }
    expect(retired.retired).toBe(true)

    await page
      .getByRole('complementary', { name: 'Template Keeper' })
      .getByRole('button', { name: 'Restore' })
      .click()
    await eventually(async () => {
      const row = (await templates().findOne({ documentId: template.id })) as unknown as {
        retired: boolean
      }
      return row.retired
    }).toBe(false)
  })

  it('editing a template opens the builder with no frame and the notice', async () => {
    const template = await newTemplate('Editable')
    const page = await open(`${base}/admin/plugins/micelio/templates`)
    await page.getByRole('complementary', { name: 'Template Editable' }).waitFor()
    await page.getByRole('button', { name: 'Edit in builder' }).click()
    await page.waitForURL(new RegExp(`/plugins/micelio/templates/${template.id}/edit`))

    await page.getByRole('heading', { name: 'Editable' }).waitFor()
    await page.getByText('No preview here').waitFor()
    await page.getByText('PREVIEW_CONTENT_TYPES', { exact: false }).waitFor()
    // The frontend renders no template: the page has no frame at all.
    expect(await page.locator('iframe').count()).toBe(0)
    // It has no keyboard layer, so the palette draws no link to the shortcuts sheet.
    expect(await page.getByRole('button', { name: 'Keyboard shortcuts' }).count()).toBe(0)
    await expect(page.getByRole('button', { name: 'Save as v2' }).isDisabled()).resolves.toBe(true)

    // The second block is fixed in the new version; saving makes version 2 with that in its history.
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]')
      .nth(1)
      .click()
    await page.getByLabel('Fixed: editors of a page cannot remove or move it').check()
    await page.getByRole('button', { name: 'Save as v2' }).click()
    await page.getByText('Saved as version 2').waitFor()
    const stored = (await templates().findOne({ documentId: template.id })) as unknown as {
      version: number
      blocks: { block: string; fixed: boolean }[]
      history: { version: number; cause: string; changes: { kind: string; block: string }[] }[]
    }
    expect(stored.version).toBe(2)
    expect(stored.blocks.map(({ fixed }) => fixed)).toEqual([true, true])
    expect(stored.history.map(({ version, cause }) => [version, cause])).toEqual([
      [1, 'save'],
      [2, 'edit'],
    ])
    expect(stored.history[1].changes).toEqual([{ kind: 'fixed', block: 'rich-text' }])
    expect(await violationsOf(page, 'main')).toEqual([])

    // Back on the page, the history lists what changed.
    await page.getByRole('link', { name: 'Back to the page templates' }).click()
    await page.getByText('Rich text: now fixed').waitFor()
  })

  it('moves, duplicates and removes a block of a template with the keys it announces, and no other', async () => {
    const template = await newTemplate('Keyed', [false, false])
    const page = await open(`${base}/admin/plugins/micelio/templates/${template.id}/edit`)
    await page.getByRole('heading', { name: 'Keyed' }).waitFor()
    const rows = page.getByRole('region', { name: /Page blocks/ }).locator('[data-block-key]')
    const names = async () =>
      rows.evaluateAll((all) => all.map((row) => (row.textContent ?? '').replace(/\d+$/, '')))
    const before = await names()
    expect(before).toHaveLength(2)

    await rows.nth(0).click()
    await page.keyboard.press('Alt+ArrowDown')
    await expect.poll(names).toEqual([before[1], before[0]])
    await page.keyboard.press('Alt+ArrowUp')
    await expect.poll(names).toEqual(before)

    await page.keyboard.press('Control+d')
    await expect.poll(async () => (await names()).length).toBe(3)
    await page.keyboard.press('Control+Backspace')
    await expect.poll(async () => (await names()).length).toBe(2)

    // Space picks the focused row up, an arrow chooses the gap and Space puts it down.
    await rows.nth(0).focus()
    await page.keyboard.press('Space')
    await page.getByText(/picked up/).waitFor({ state: 'attached' })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Space')
    await page.getByText(/picked up/).waitFor({ state: 'detached' })
    await expect.poll(names).toEqual([before[1], before[0]])

    // Esc puts a picked-up block down where it was.
    await rows.nth(0).focus()
    await page.keyboard.press('Space')
    await page.getByText(/picked up/).waitFor({ state: 'attached' })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await page.getByText(/picked up/).waitFor({ state: 'detached' })
    await expect.poll(names).toEqual([before[1], before[0]])

    // Enter on a palette row inserts it after the selection, as the palette's help line says.
    await page
      .getByRole('complementary', { name: 'Block palette' })
      .getByRole('button', { name: /Rich text/ })
      .first()
      .focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await names()).length).toBe(3)
    await page.keyboard.press('Control+Backspace')
    await expect.poll(async () => (await names()).length).toBe(2)

    // A key the editor does not announce does nothing: the sheet does not open, nothing is saved.
    await rows.nth(0).click()
    await page.keyboard.press('2')
    await page.getByRole('heading', { name: `${before[1]} in a new page` }).waitFor()
    await page.keyboard.press('?')
    await page.keyboard.press('Control+s')
    expect(await page.getByRole('dialog').count()).toBe(0)
    expect(await page.getByText('Saved as version', { exact: false }).count()).toBe(0)
  })

  it('says nothing was saved when the save is refused', async () => {
    const template = await newTemplate('Contested')
    const page = await open(`${base}/admin/plugins/micelio/templates/${template.id}/edit`)
    await page.getByRole('heading', { name: 'Contested' }).waitFor()
    await page
      .getByRole('region', { name: /Page blocks/ })
      .locator('[data-block-key]')
      .nth(1)
      .click()
    await page.getByLabel('Fixed: editors of a page cannot remove or move it').check()
    // Another session saves version 2 first, so this save carries a stale version.
    const detail = (await service().detail(template.id))!
    await service().update(
      template.id,
      { expectedVersion: 1, blocks: [{ ...detail.blocks[0], fixed: false }, detail.blocks[1]] },
      'Pat'
    )
    await page.getByRole('button', { name: 'Save as v2' }).click()
    await page.getByText('Someone saved a newer version first').first().waitFor()
    expect(await page.getByText('Saved the template', { exact: false }).count()).toBe(0)
    const stored = (await templates().findOne({ documentId: template.id })) as unknown as {
      blocks: { fixed: boolean }[]
    }
    // Only the other session's version is stored: the refused save wrote nothing.
    expect(stored.blocks.map(({ fixed }) => fixed)).toEqual([false, false])
  })

  it('shows the Template tab: what changed, the offer, the fixed blocks and detach', async () => {
    const template = await newTemplate('Explainer landing')
    const { documentId } = await pageFrom(template.id, 'My explainer')
    // The template moves on: its grid stops being fixed and a second text arrives after the first.
    const detail = (await service().detail(template.id))!
    await service().update(
      template.id,
      {
        expectedVersion: 1,
        blocks: [
          { ...detail.blocks[0], fixed: false },
          detail.blocks[1],
          { ...detail.blocks[1], data: { body: 'A closing note.' } },
        ],
      },
      'Pat Publisher'
    )

    const page = await open(`${base}/admin/plugins/micelio/builder/${GUIDE_UID}/${documentId}`)
    const list = page.getByRole('region', { name: /Page blocks/ })
    await list.locator('[data-block-key]').first().click()
    // The block the template fixed cannot be removed or moved.
    await expect(
      page.getByRole('button', { name: 'Remove', exact: true }).isDisabled()
    ).resolves.toBe(true)

    await page.getByRole('button', { name: 'Page settings' }).click()
    const drawer = page.getByRole('dialog', { name: 'Page settings' })
    await drawer.getByRole('tab', { name: 'Template' }).click()
    await drawer.getByText('Explainer landing').waitFor()
    await drawer.getByText('the template is now at v2', { exact: false }).waitFor()
    await drawer.getByText('What changed in v2').waitFor()
    await drawer.getByText('New block after Rich text: Rich text').waitFor()
    await drawer.getByText('Feature grid: no longer fixed').waitFor()
    await drawer.getByText('Fixed blocks on this page').waitFor()
    await drawer.getByText('fixed by template').waitFor()
    expect(await violationsOf(page, '[role="dialog"]')).toEqual([])

    // An offer, never automatic: nothing changed until it is applied.
    const before = (await guides().findOne({
      documentId,
      locale: 'en',
      populate: ['sections'],
    })) as unknown as { sections: unknown[]; templateVersion: number }
    expect(before.sections).toHaveLength(2)
    expect(before.templateVersion).toBe(1)
    await drawer.getByRole('button', { name: 'Apply the structure changes' }).click()
    await drawer.getByText('up to date').waitFor()
    const after = (await guides().findOne({
      documentId,
      locale: 'en',
      populate: ['sections'],
    })) as unknown as { sections: { __component: string }[]; templateVersion: number }
    expect(after.sections.map(({ __component }) => __component)).toEqual([
      'section.feature-grid',
      'section.rich-text',
      'section.rich-text',
    ])
    expect(after.templateVersion).toBe(2)
    // The lock followed the template: the grid is no longer fixed.
    expect(await drawer.getByText('Fixed blocks on this page').count()).toBe(0)

    await drawer.getByRole('button', { name: /^Detach from template/ }).click()
    await drawer.getByText('This page was made without a template', { exact: false }).waitFor()
    const detached = (await guides().findOne({ documentId, locale: 'en' })) as unknown as {
      templateId: string | null
    }
    expect(detached.templateId).toBeNull()
  })

  it('lists what a switch would drop before it is made', async () => {
    const first = await newTemplate('Grid and text', [false, false])
    const second = await service().save({
      site: siteRef(),
      uid: GUIDE_UID,
      documentId: await newGuide(),
      locale: 'en',
      name: 'Text only',
      scope: 'site',
      blocks: [
        { content: 'sample', fixed: false },
        { content: 'sample', fixed: false },
      ],
    })
    await service().update(
      second.id,
      { expectedVersion: 1, blocks: (await service().detail(second.id))!.blocks.slice(1) },
      'Pat'
    )
    const { documentId } = await pageFrom(first.id, 'To switch')
    const page = await open(`${base}/admin/plugins/micelio/builder/${GUIDE_UID}/${documentId}`)
    await page.getByRole('button', { name: 'Page settings' }).click()
    const drawer = page.getByRole('dialog', { name: 'Page settings' })
    await drawer.getByRole('tab', { name: 'Template' }).click()
    await drawer.getByRole('button', { name: /^Switch template…/ }).click()
    await drawer.getByLabel('Switch to').selectOption({ label: 'Text only' })
    await drawer.getByText('Would drop: Feature grid').waitFor()
    await drawer.getByText('Keeps 1 block: Rich text').waitFor()
    // Looking changed nothing.
    expect(
      ((await guides().findOne({ documentId, locale: 'en' })) as unknown as { templateId: string })
        .templateId
    ).toBe(first.id)
    await drawer.getByRole('button', { name: 'Switch to Text only' }).click()
    await drawer.getByText('Text only').first().waitFor()
    const switched = (await guides().findOne({
      documentId,
      locale: 'en',
      populate: ['sections'],
    })) as unknown as { templateId: string; sections: unknown[] }
    expect(switched.templateId).toBe(second.id)
    expect(switched.sections).toHaveLength(1)
  })

  it('shows a page made without a template only the way to save it as one', async () => {
    const documentId = await newGuide()
    const page = await open(`${base}/admin/plugins/micelio/builder/${GUIDE_UID}/${documentId}`)
    await page.getByRole('button', { name: 'Page settings' }).click()
    const drawer = page.getByRole('dialog', { name: 'Page settings' })
    await drawer.getByRole('tab', { name: 'Template' }).click()
    await drawer.getByText('This page was made without a template', { exact: false }).waitFor()
    expect(await drawer.getByRole('button', { name: /^Detach/ }).count()).toBe(0)
    await drawer.getByRole('button', { name: /^Save this page as a new template…/ }).click()
    await page.getByRole('dialog', { name: 'Save as template' }).waitFor()
  })

  it('shows the Page templates item only to a role that may manage templates', async () => {
    const roles = strapi.service('admin::role')
    const role = await roles.create({ name: 'No templates', description: 'Reads status only' })
    await roles.assignPermissions(role.id, [
      { action: 'plugin::micelio.status.read', subject: null, properties: {}, conditions: [] },
    ])
    const page = await open(`${base}/admin/plugins/micelio`, role.id as number)
    await page.getByRole('link', { name: 'Status' }).waitFor()
    expect(await page.getByRole('link', { name: 'Page templates' }).count()).toBe(0)
    const own = await open(`${base}/admin/plugins/micelio`)
    await own.getByRole('link', { name: 'Page templates' }).waitFor()
  })
})
