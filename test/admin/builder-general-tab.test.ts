import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import type { Core, UID } from '@strapi/strapi'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type { PluginConfig } from '../../server/src/config'
import { REDIRECT_UID } from '../../server/src/constants/page-settings'
import { SITE_UID } from '../../server/src/constants/site'
import type { TransitionsService } from '../../server/src/services/transitions'
import { cleanupStrapi, setupStrapi } from '../strapi/harness'
import { startPreviewSite, type PreviewSite } from '../strapi/preview-site'

// An editorial page with sections made with `withPageSettings` (test/strapi/app/src/api/guide/).
const GUIDE_UID = 'api::guide.guide' as UID.ContentType
// An editorial page of the test app that has no page settings: the builder shows no gear for it.
const LANDING_UID = 'api::landing.landing' as UID.ContentType
const PASSWORD = 'Password1234'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

/** `expect.poll` with the time a save, a frame reload and its report take. */
const eventually = <T>(read: () => Promise<T> | T) => expect.poll(read, { timeout: 20_000 })

describe('the General tab of the page settings in the builder', () => {
  let strapi: Core.Strapi
  let base: string
  let site: PreviewSite
  let browser: Browser
  let siteDocumentId = ''
  let superAdminId = 0
  let admins = 0
  let actor: { kind: 'user'; id: number; roles: string[] }
  const contexts: BrowserContext[] = []
  const guides = () => strapi.documents(GUIDE_UID)
  const redirects = () => strapi.documents(REDIRECT_UID as UID.ContentType)

  const builderPath = (uid: string, documentId: string) =>
    `${base}/admin/plugins/micelio/builder/${uid}/${documentId}`

  async function newGuide(slug: string, pageType = 'standard'): Promise<string> {
    const created = await guides().create({
      locale: 'en',
      data: {
        title: 'Open source, in plain words',
        slug,
        pageType,
        site: siteDocumentId,
        sections: [{ __component: 'section.rich-text', body: 'One' }],
      } as never,
    })
    return created.documentId
  }

  const move = (documentId: string, to: 'in_review' | 'published') =>
    (strapi.plugin('micelio').service('transitions') as TransitionsService).perform({
      uid: GUIDE_UID,
      documentId,
      locale: 'en',
      to,
      actor,
    })

  /** A guide that is live under this slug. */
  async function publishedGuide(slug: string): Promise<string> {
    const documentId = await newGuide(slug)
    await move(documentId, 'in_review')
    await move(documentId, 'published')
    return documentId
  }

  /** A live guide renamed and published again: the redirect from its old address is written. */
  async function renamedWhilePublished(from: string, to: string): Promise<string> {
    const documentId = await publishedGuide(from)
    await guides().update({ documentId, locale: 'en', data: { slug: to } as never })
    await move(documentId, 'published')
    return documentId
  }

  async function draftOf(documentId: string) {
    return (await guides().findOne({
      documentId,
      locale: 'en',
      status: 'draft',
      populate: ['visibility'],
    } as never)) as unknown as {
      slug: string
      pageType: string
      visibility: { inMenu: boolean; inSitemap: boolean; noindex: boolean } | null
    }
  }

  async function open(path: string): Promise<Page> {
    admins += 1
    const email = `general-tab-${admins}@example.com`
    await strapi.service('admin::user').create({
      email,
      firstname: 'Admin',
      lastname: 'Test',
      password: PASSWORD,
      roles: [superAdminId],
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

  const gear = (page: Page) => page.getByRole('button', { name: 'Page settings' })
  const drawer = (page: Page) => page.getByRole('dialog', { name: 'Page settings' })
  const typeButtons = (page: Page) =>
    drawer(page).getByRole('group', { name: 'Page type' }).getByRole('button')

  async function openDrawer(page: Page): Promise<void> {
    await gear(page).click()
    await drawer(page).waitFor()
  }

  async function violationsOf(page: Page): Promise<unknown[]> {
    const results = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze()
    return results.violations.flatMap(({ id, nodes }) =>
      nodes.map(({ target }) => ({ id, target }))
    )
  }

  beforeAll(async () => {
    process.env.SERVE_ADMIN_PANEL = 'true'
    strapi = await setupStrapi()
    const budgets = strapi.config.get<PluginConfig['budgets']>('plugin::micelio.budgets')
    // The guides are measured, and `manifesto` is a page type of this site's own.
    strapi.config.set('plugin::micelio.budgets', {
      ...budgets,
      pageTypes: { ...budgets.pageTypes, manifesto: 30 },
      contentTypes: [GUIDE_UID],
    })
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    site = await startPreviewSite()
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    const defaultSite = (await sites.findFirst()) as { documentId: string }
    siteDocumentId = defaultSite.documentId
    await sites.update({ documentId: siteDocumentId, data: { url: site.origin } as never })
    const apiToken = (await strapi.service('admin::api-token').create({
      name: 'general-tab-test',
      type: 'custom',
      lifespan: null,
      permissions: ['plugin::micelio.preview.exchange', 'plugin::micelio.preview.draft'],
    })) as { accessKey: string }
    site.connect({ base, apiToken: apiToken.accessKey, adminOrigin: base })
    const superAdmin = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    superAdminId = superAdmin.id
    const user = await strapi.service('admin::user').create({
      email: 'general-tab-suite@example.com',
      firstname: 'Suite',
      lastname: 'Admin',
      password: PASSWORD,
      roles: [superAdmin.id],
      isActive: true,
    })
    actor = { kind: 'user', id: user.id as number, roles: ['strapi-super-admin'] }
    browser = await chromium.launch()
  })

  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close()
    for (const { documentId } of (await redirects().findMany({})) as unknown as {
      documentId: string
    }[]) {
      await redirects().delete({ documentId })
    }
  })

  afterAll(async () => {
    await browser?.close()
    await site?.close()
    await cleanupStrapi()
    delete process.env.SERVE_ADMIN_PANEL
  })

  it('the drawer offers the page types the budgets list, custom ones included', async () => {
    const page = await open(builderPath(GUIDE_UID, await newGuide('types')))
    await openDrawer(page)

    // From the lightest budget to the heaviest: 30, 60, 120 and 200 kB in the test app.
    await eventually(() => typeButtons(page).allTextContents()).toEqual([
      'Manifesto',
      'Landing',
      'Standard',
      'Long read',
    ])
    await expect(
      typeButtons(page).filter({ hasText: 'Standard' }).getAttribute('aria-pressed')
    ).resolves.toBe('true')
    await drawer(page)
      .getByText('Sets the weight budget (Standard: 120 kB)', { exact: false })
      .waitFor()
    expect(await violationsOf(page)).toEqual([])
  })

  it('removing a redirect from the drawer deletes it', async () => {
    const documentId = await renamedWhilePublished('open-source-explained', 'open-source')
    expect(await redirects().findMany({})).toHaveLength(1)
    const page = await open(builderPath(GUIDE_UID, documentId))
    await openDrawer(page)

    await drawer(page).getByText('/open-source-explained → /open-source').waitFor()
    await drawer(page)
      .getByRole('button', { name: 'Remove the redirect from /open-source-explained' })
      .click()

    await drawer(page).getByText('No redirects yet', { exact: false }).waitFor()
    await eventually(async () => (await redirects().findMany({})).length).toBe(0)
  })

  it('changing the page type saves it with the draft and measures the page against the new budget', async () => {
    const documentId = await newGuide('weigh')
    const page = await open(builderPath(GUIDE_UID, documentId))
    await openDrawer(page)
    await eventually(() => page.getByTestId('toolbar-meter').textContent()).toContain('/ 120 kB')

    await typeButtons(page).filter({ hasText: 'Landing' }).click()

    await eventually(async () => (await draftOf(documentId)).pageType).toBe('landing')
    await eventually(() => page.getByTestId('toolbar-meter').textContent()).toContain('/ 60 kB')
    await expect(
      typeButtons(page).filter({ hasText: 'Landing' }).getAttribute('aria-pressed')
    ).resolves.toBe('true')
    await drawer(page).getByText('Saved').waitFor()
  })

  it('saves the slug when its field is left, and tells a published page that a redirect follows', async () => {
    const documentId = await publishedGuide('first')
    const page = await open(builderPath(GUIDE_UID, documentId))
    await openDrawer(page)
    await drawer(page).getByText('Published as /first', { exact: false }).waitFor()

    await drawer(page).getByLabel('Slug').fill('second')
    await drawer(page).getByLabel('Slug').blur()

    await eventually(async () => (await draftOf(documentId)).slug).toBe('second')
    await drawer(page).getByText('Published before as /first', { exact: false }).waitFor()
    // A draft's slug changes no address: nothing is redirected until it is published.
    expect(await redirects().findMany({})).toHaveLength(0)
  })

  it('refuses a slug with a slash without saving it', async () => {
    const documentId = await newGuide('plain')
    const page = await open(builderPath(GUIDE_UID, documentId))
    await openDrawer(page)
    const saves: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'PUT') saves.push(request.url())
    })

    await drawer(page).getByLabel('Slug').fill('a/b')
    await drawer(page).getByLabel('Slug').blur()

    await drawer(page).getByText('A slug uses letters, digits', { exact: false }).waitFor()
    // The field is checked before it is sent: no save leaves the page.
    expect(saves).toEqual([])
    expect((await draftOf(documentId)).slug).toBe('plain')
  })

  it('saves where the page shows up', async () => {
    const documentId = await newGuide('visible')
    const page = await open(builderPath(GUIDE_UID, documentId))
    await openDrawer(page)

    await drawer(page).getByRole('checkbox', { name: 'In the navigation menu' }).click()
    await drawer(page)
      .getByRole('checkbox', { name: /Hidden from search engines/ })
      .click()

    await eventually(async () => (await draftOf(documentId)).visibility).toMatchObject({
      inMenu: false,
      inSitemap: true,
      noindex: true,
    })
  })

  it('opens with ⌘, from the page, shuts with Esc and gives focus back to the gear', async () => {
    const page = await open(builderPath(GUIDE_UID, await newGuide('keys')))
    await gear(page).waitFor()

    await gear(page).focus()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+Comma')
    await drawer(page).waitFor()
    // The focus is in the drawer: on the slug.
    const slugId = await drawer(page).getByLabel('Slug').getAttribute('id')
    await expect(page.evaluate('document.activeElement?.id')).resolves.toBe(slugId)
    await page.keyboard.press('Escape')
    await drawer(page).waitFor({ state: 'detached' })
    await expect(page.evaluate('document.activeElement?.getAttribute("aria-label")')).resolves.toBe(
      'Page settings'
    )
  })

  /**
   * Runs `work` with every browser opened as a user of a role that may preview, read the site and
   * read the guide (and change it when `canUpdate`), and read the redirects when `canReadRedirects`.
   */
  async function asRole(
    code: string,
    options: { canUpdate: boolean; canReadRedirects: boolean },
    work: () => Promise<void>
  ): Promise<void> {
    const role = (await strapi.service('admin::role').create({ name: code, code })) as {
      id: number
    }
    const fields = ['title', 'slug', 'pageType', 'visibility', 'sections', 'site']
    const permission = (action: string, subject: string | null, fieldList?: string[]) => ({
      action,
      subject,
      conditions: [],
      properties: fieldList ? { fields: fieldList, locales: ['en'] } : {},
    })
    await strapi
      .service('admin::role')
      .addPermissions(role.id, [
        permission('plugin::micelio.preview', null),
        permission('plugin::content-manager.explorer.read', GUIDE_UID, fields),
        permission(
          'plugin::content-manager.explorer.read',
          SITE_UID,
          Object.keys(strapi.contentType(SITE_UID as UID.ContentType).attributes)
        ),
        ...(options.canUpdate
          ? [permission('plugin::content-manager.explorer.update', GUIDE_UID, fields)]
          : []),
        ...(options.canReadRedirects
          ? [
              permission('plugin::content-manager.explorer.read', REDIRECT_UID, [
                'from',
                'to',
                'entryLocale',
                'rule',
                'site',
              ]),
            ]
          : []),
      ])
    const previous = superAdminId
    superAdminId = role.id
    try {
      await work()
    } finally {
      superAdminId = previous
    }
  }

  it('is read-only for a role that may not change the page, and says why it lists no redirects', async () => {
    await asRole('page-reader', { canUpdate: false, canReadRedirects: false }, async () => {
      const documentId = await renamedWhilePublished('before-reading', 'reading')
      const page = await open(builderPath(GUIDE_UID, documentId))
      await openDrawer(page)

      await drawer(page).getByText('Your role may not read redirects.').waitFor()
      await expect(drawer(page).getByLabel('Slug').getAttribute('readonly')).resolves.not.toBeNull()
      await expect(typeButtons(page).first().isDisabled()).resolves.toBe(true)
      await expect(
        drawer(page).getByRole('checkbox', { name: 'In the navigation menu' }).isDisabled()
      ).resolves.toBe(true)
    })
  })

  it('says so when the server refuses to remove a redirect', async () => {
    await asRole('page-editor', { canUpdate: true, canReadRedirects: true }, async () => {
      const documentId = await renamedWhilePublished('before-removing', 'removing')
      const page = await open(builderPath(GUIDE_UID, documentId))
      await openDrawer(page)

      // The role may read the redirect and not delete it: the Content Manager answers 403.
      await drawer(page)
        .getByRole('button', { name: 'Remove the redirect from /before-removing' })
        .click()

      await drawer(page).getByText('The redirect was not removed.').waitFor()
      expect(await redirects().findMany({})).toHaveLength(1)
    })
  })

  it('shows no gear on a page type without page settings', async () => {
    const created = await strapi.documents(LANDING_UID).create({
      locale: 'en',
      data: { title: 'Plain', site: siteDocumentId, sections: [] } as never,
    })
    const page = await open(builderPath(LANDING_UID, created.documentId))
    await page.getByRole('region', { name: /Page blocks/ }).waitFor()
    expect(await gear(page).count()).toBe(0)
  })
})
