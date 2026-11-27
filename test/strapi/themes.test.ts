import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { THEME_ACTIVATION_UID, THEMES_MANAGE_PERMISSION } from '../../server/src/constants/themes'
import type { ThemesAnswer, ThemePin } from '../../server/src/types/themes'
import { closedOrigin } from './frontend'
import { cleanupStrapi, setupStrapi } from './harness'
import { newThemeBehaviour, startThemeSite, type ThemeSite } from './theme-site'

const PASSWORD = 'Password1234'

type Role = 'strapi-super-admin' | 'strapi-editor'

interface SiteRow {
  id: number
  documentId: string
  theme: (ThemePin & { defaultMode?: string | null; accentOverrides?: unknown[] }) | null
}

describe('the themes routes', () => {
  let strapi: Core.Strapi
  let base: string
  let frontend: ThemeSite
  let unreachable: string
  const tokens = {} as Record<Role, string>

  let admins = 0
  let superAdminEmail = ''

  /** Logs in a new user of the role; for the super admin, the user `call` sends as from now on. */
  async function login(role: Role): Promise<void> {
    const roleRow = (await strapi.db.query('admin::role').findOne({ where: { code: role } })) as {
      id: number
    }
    admins += 1
    // The two write routes allow five changes a minute per admin user: a test starts with a new one.
    const email = role === 'strapi-editor' ? `${role}@example.com` : `admin-${admins}@example.com`
    if (role === 'strapi-super-admin') superAdminEmail = email
    await strapi.service('admin::user').create({
      email,
      firstname: role,
      lastname: 'Test',
      password: PASSWORD,
      roles: [roleRow.id],
      isActive: true,
    })
    const response = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    tokens[role] = ((await response.json()) as { data: { token: string } }).data.token
  }

  function call(path: string, body?: unknown, role: Role = 'strapi-super-admin') {
    return fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${tokens[role]}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  async function siteRow(slug: string): Promise<SiteRow> {
    return (await strapi.db.query(SITE_UID).findOne({
      where: { slug },
      populate: { theme: { populate: { accentOverrides: true } } },
    })) as SiteRow
  }

  async function pinOf(slug: string): Promise<ThemePin> {
    const { theme } = await siteRow(slug)
    return {
      themeId: theme?.themeId ?? null,
      themeVersion: theme?.themeVersion ?? null,
      themeDigest: theme?.themeDigest ?? null,
    }
  }

  async function setPin(slug: string, theme: Record<string, unknown> | null): Promise<void> {
    const { documentId } = await siteRow(slug)
    await strapi
      .documents(SITE_UID as UID.ContentType)
      .update({ documentId, data: { theme } as never })
  }

  const logRows = async () =>
    (await strapi.db.query(THEME_ACTIVATION_UID as UID.ContentType).findMany({
      orderBy: { id: 'asc' },
      populate: { site: true },
    })) as {
      action: string
      pinBefore: ThemePin
      pinAfter: ThemePin
      adminUserId: number | null
      createdAt: string
      site: { slug: string } | null
    }[]

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const behaviour = newThemeBehaviour()
    // The stub's switch reads the default site's pin, as the frontend reads its site settings.
    behaviour.readPin = async () => pinOf('default')
    frontend = await startThemeSite(behaviour)
    unreachable = await closedOrigin()
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    const defaultSite = (await sites.findFirst({ filters: { isDefault: true } })) as {
      documentId: string
    }
    await sites.update({
      documentId: defaultSite.documentId,
      data: { url: `${frontend.origin}/` } as never,
    })
    await sites.create({
      data: {
        name: 'The shop',
        slug: 'shop',
        hosts: ['shop.example.com'],
        isDefault: false,
        defaultLocale: 'en',
        modules: {},
        url: unreachable,
      } as never,
    })
    await login('strapi-editor')
  })

  beforeEach(async () => {
    await login('strapi-super-admin')
    frontend.themes.behaviour.isDown = false
    await strapi.db.query(THEME_ACTIVATION_UID as UID.ContentType).deleteMany({})
    await setPin('default', null)
  })

  afterAll(async () => {
    await frontend?.close()
    await cleanupStrapi()
  })

  it("answers the frontend's status and catalogue for a site, and says so when the frontend does not answer", async () => {
    const response = await call('/micelio/themes')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const { data } = (await response.json()) as { data: ThemesAnswer }
    expect(data.sites.map(({ slug, isDefault }) => [slug, isDefault])).toEqual([
      ['default', true],
      ['shop', false],
    ])
    expect(data.site).toMatchObject({ slug: 'default', isDefault: true, origin: frontend.origin })
    expect(data.pin).toEqual({ themeId: null, themeVersion: null, themeDigest: null })
    expect(data.status?.active.id).toBe('bogota')
    expect(data.status?.requested).toBeNull()
    expect(data.status?.available.builtIn.map(({ id, code }) => [id, code])).toEqual([
      ['bogota', true],
      ['starter', false],
    ])
    expect(data.catalogue?.installed.map(({ id, version, store }) => [id, version, store])).toEqual(
      [
        ['bogota', '1.0.0', 'built-in'],
        ['starter', '1.2.0', 'built-in'],
      ]
    )
    expect(data.catalogue?.registry?.map(({ id }) => id)).toEqual(['starter', 'sendero', 'mosaico'])
    expect(data.catalogue?.updates).toMatchObject([
      { id: 'starter', from: '1.2.0', version: '1.3.0' },
    ])
    expect(data.catalogue?.reports).toHaveLength(5)
    expect(data.revert).toBeNull()
    expect(Array.isArray(data.pages)).toBe(true)

    // A site whose frontend refuses the connection, and one that answers 503: the answer says so, no failure.
    const shop = (await (await call('/micelio/themes?site=shop')).json()) as { data: ThemesAnswer }
    expect(shop.data.site).toMatchObject({ slug: 'shop', isDefault: false })
    expect([shop.data.status, shop.data.catalogue]).toEqual([null, null])
    frontend.themes.behaviour.isDown = true
    const down = await call('/micelio/themes?site=default')
    expect(down.status).toBe(200)
    const { data: downData } = (await down.json()) as { data: ThemesAnswer }
    expect([downData.status, downData.catalogue]).toEqual([null, null])

    const missing = await call('/micelio/themes?site=nowhere')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ code: 'themeSiteNotFound' })
  })

  it('answers in pages the newest draft of each page type of the site', async () => {
    const guides = strapi.documents('api::guide.guide' as UID.ContentType)
    const { documentId: siteId } = await siteRow('default')
    const { documentId: shopId } = await siteRow('shop')
    const make = async (title: string, pageType: string, site: string) =>
      (
        await guides.create({
          locale: 'en',
          data: { title, slug: title.toLowerCase().replace(/ /g, '-'), pageType, site } as never,
        })
      ).documentId
    try {
      const older = await make('Older standard', 'standard', siteId)
      const longRead = await make('A long read', 'long-read', siteId)
      await make('Shop landing', 'landing', shopId)
      const newer = await make('Newer standard', 'standard', siteId)
      const { data } = (await (await call('/micelio/themes')).json()) as { data: ThemesAnswer }
      // One entry per page type, the newest draft of each, newest first; another site's page is not one.
      expect(data.pages).toEqual([
        {
          uid: 'api::guide.guide',
          documentId: newer,
          locale: 'en',
          title: 'Newer standard',
          pageType: 'standard',
        },
        {
          uid: 'api::guide.guide',
          documentId: longRead,
          locale: 'en',
          title: 'A long read',
          pageType: 'long-read',
        },
      ])
      expect(data.pages.map(({ documentId }) => documentId)).not.toContain(older)
      const shop = (await (await call('/micelio/themes?site=shop')).json()) as {
        data: ThemesAnswer
      }
      expect(shop.data.pages.map(({ title, pageType }) => [title, pageType])).toEqual([
        ['Shop landing', 'landing'],
      ])
    } finally {
      await strapi.db.query('api::guide.guide').deleteMany({})
    }
  })

  it("activates a built-in theme by writing its id alone to the site's pin, and records the activation", async () => {
    // The fields of the component the page does not change are kept.
    await setPin('default', {
      themeId: 'bogota',
      defaultMode: 'dark',
      accentOverrides: [{ mode: 'light', color: '#123456' }],
    })
    const info = vi.spyOn(strapi.log, 'info')
    const response = await call('/micelio/themes/activate', { id: 'starter', version: '1.2.0' })
    expect(response.status).toBe(200)
    // One line of the log, with the user's id and no name or email.
    const lines = info.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes('theme'))
    info.mockRestore()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(
      /^\[micelio\] activated theme starter on site default \(was theme bogota\), admin user \d+$/
    )
    const before = { themeId: 'bogota', themeVersion: null, themeDigest: null }
    const after = { themeId: 'starter', themeVersion: null, themeDigest: null }
    expect(await response.json()).toEqual({ data: { site: 'default', before, after } })
    expect(await pinOf('default')).toEqual(after)
    const { theme } = await siteRow('default')
    expect(theme?.defaultMode).toBe('dark')
    expect(theme?.accentOverrides).toMatchObject([{ mode: 'light', color: '#123456' }])

    const superAdmin = (await strapi.db
      .query('admin::user')
      .findOne({ where: { email: superAdminEmail } })) as { id: number }
    const rows = await logRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      action: 'activate',
      pinBefore: before,
      pinAfter: after,
      adminUserId: superAdmin.id,
      site: { slug: 'default' },
    })
    expect(Number.isNaN(Date.parse(rows[0]!.createdAt))).toBe(false)

    // The frontend switches to it, and the page reads it from the status.
    const { data } = (await (await call('/micelio/themes')).json()) as { data: ThemesAnswer }
    expect(data.status?.active.id).toBe('starter')
    expect(data.status?.lastGood?.id).toBe('bogota')
    expect(data.revert).toEqual({ pin: before, isInstalled: true })

    // A data-only theme of the registry: the version and the digest the catalogue lists.
    const sendero = frontend.themes.behaviour.catalogue.registry!.find(
      ({ id }) => id === 'sendero'
    )!
    const next = await call('/micelio/themes/activate', {
      site: 'default',
      id: 'sendero',
      version: '2.1.0',
    })
    expect(next.status).toBe(200)
    expect(await pinOf('default')).toEqual({
      themeId: 'sendero',
      themeVersion: '2.1.0',
      themeDigest: sendero.versions[0]!.digest,
    })
    expect((await logRows()).map(({ action }) => action)).toEqual(['activate', 'activate'])

    // The log is an internal type: hidden from the Content Manager and the Content-Type Builder, never exported.
    const schema = strapi.contentType(THEME_ACTIVATION_UID as UID.ContentType)
    expect(schema.pluginOptions?.['content-manager']).toEqual({ visible: false })
    expect(schema.pluginOptions?.['content-type-builder']).toEqual({ visible: false })
    expect(schema.pluginOptions?.micelio).toMatchObject({ export: 'never', siteScoped: true })
    expect(schema.attributes.site).toMatchObject({ type: 'relation', target: SITE_UID })

    // A body outside the pin's grammar, and a theme the frontend does not know, from another admin
    // user: this one made two changes, and each of these counts too.
    await login('strapi-super-admin')
    for (const body of [
      {},
      { id: 'Not A Slug' },
      { id: 'starter', version: '1.2' },
      { id: 'starter', site: 3 },
    ]) {
      const refused = await call('/micelio/themes/activate', body)
      expect(refused.status, JSON.stringify(body)).toBe(400)
      expect(await refused.json()).toMatchObject({ code: 'themeRequestInvalid' })
    }
    const unknown = await call('/micelio/themes/activate', { id: 'nadie', version: '1.0.0' })
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ code: 'themeUnknown' })
    expect(await logRows()).toHaveLength(2)
  })

  it('refuses to activate a code theme the frontend was not built with, with themeRebuildRequired, and writes nothing', async () => {
    await setPin('default', { themeId: 'starter' })
    const response = await call('/micelio/themes/activate', { id: 'mosaico', version: '0.9.0' })
    expect(response.status).toBe(409)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    expect(await response.json()).toMatchObject({ status: 409, code: 'themeRebuildRequired' })
    expect(await pinOf('default')).toEqual({
      themeId: 'starter',
      themeVersion: null,
      themeDigest: null,
    })
    expect(await logRows()).toEqual([])

    // A frontend that does not answer its status decides nothing either.
    frontend.themes.behaviour.isDown = true
    const down = await call('/micelio/themes/activate', { id: 'bogota' })
    expect(down.status).toBe(502)
    expect(await down.json()).toMatchObject({ code: 'themesFrontendUnavailable' })
    expect(await pinOf('default')).toEqual({
      themeId: 'starter',
      themeVersion: null,
      themeDigest: null,
    })
    expect(await logRows()).toEqual([])
  })

  it('reverts to the pin the last activation replaced while that theme is installed, and refuses when it is not', async () => {
    // Nothing to revert yet.
    const none = await call('/micelio/themes/revert', {})
    expect(none.status).toBe(409)
    expect(await none.json()).toMatchObject({ code: 'themeRevertUnavailable' })

    await setPin('default', { themeId: 'bogota' })
    expect(
      (await call('/micelio/themes/activate', { id: 'starter', version: '1.2.0' })).status
    ).toBe(200)
    const reverted = await call('/micelio/themes/revert', { site: 'default' })
    expect(reverted.status).toBe(200)
    const bogota = { themeId: 'bogota', themeVersion: null, themeDigest: null }
    const starter = { themeId: 'starter', themeVersion: null, themeDigest: null }
    expect(await reverted.json()).toEqual({
      data: { site: 'default', before: starter, after: bogota },
    })
    expect(await pinOf('default')).toEqual(bogota)
    const rows = await logRows()
    expect(rows.map(({ action, pinBefore, pinAfter }) => [action, pinBefore, pinAfter])).toEqual([
      ['activate', bogota, starter],
      ['revert', starter, bogota],
    ])
    // A revert is not reverted: the last change was one.
    const again = await call('/micelio/themes/revert', {})
    expect(again.status).toBe(409)
    expect((await logRows()).length).toBe(2)

    // A theme the image no longer holds: the revert is refused and writes nothing. Another admin user:
    // this one made five changes.
    await login('strapi-super-admin')
    const sendero = {
      themeId: 'sendero',
      themeVersion: '2.1.0',
      themeDigest: `sha256:${'b'.repeat(64)}`,
    }
    await setPin('default', sendero)
    expect(
      (await call('/micelio/themes/activate', { id: 'starter', version: '1.2.0' })).status
    ).toBe(200)
    const { data } = (await (await call('/micelio/themes')).json()) as { data: ThemesAnswer }
    expect(data.revert).toEqual({ pin: sendero, isInstalled: false })
    const refused = await call('/micelio/themes/revert', {})
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ code: 'themeRevertUnavailable' })
    expect(await pinOf('default')).toEqual(starter)

    // A pin changed in the Content Manager after the activation is not overwritten by a revert.
    expect((await call('/micelio/themes/activate', { id: 'bogota' })).status).toBe(200)
    await setPin('default', { themeId: 'starter' })
    expect((await call('/micelio/themes/revert', {})).status).toBe(409)
    expect(await pinOf('default')).toEqual(starter)
  })

  it('answers 403 to an admin user without plugin::micelio.themes.manage on the three routes', async () => {
    const editor = (await strapi.db
      .query('admin::user')
      .findOne({ where: { email: 'strapi-editor@example.com' }, populate: { roles: true } })) as {
      roles: { code: string }[]
    }
    expect(editor.roles.map(({ code }) => code)).toEqual(['strapi-editor'])
    for (const [path, body] of [
      ['/micelio/themes', undefined],
      ['/micelio/themes/activate', { id: 'starter' }],
      ['/micelio/themes/revert', {}],
    ] as const) {
      const response = await call(path, body, 'strapi-editor')
      expect(response.status, path).toBe(403)
      expect(response.headers.get('content-type')).toContain('application/problem+json')
      expect(await response.json()).toMatchObject({ code: 'themesForbidden' })
    }
    expect(await pinOf('default')).toEqual({ themeId: null, themeVersion: null, themeDigest: null })
    expect(await logRows()).toEqual([])
    // The permission is registered, for a role to be given it in Settings → Roles; the super admin has it.
    const actions = strapi.service('admin::permission').actionProvider.values() as {
      actionId: string
    }[]
    expect(actions.map(({ actionId }) => actionId)).toContain(THEMES_MANAGE_PERMISSION)
    // Without an admin token, Strapi's 401.
    expect((await fetch(`${base}/micelio/themes`)).status).toBe(401)
  })

  it('answers 429 with Retry-After to the sixth activate or revert of an admin user in a minute, and writes nothing', async () => {
    await setPin('default', { themeId: 'bogota' })
    for (const [path, body] of [
      ['/micelio/themes/activate', { id: 'starter', version: '1.2.0' }],
      ['/micelio/themes/revert', {}],
      ['/micelio/themes/activate', { id: 'starter', version: '1.2.0' }],
      ['/micelio/themes/revert', {}],
      ['/micelio/themes/activate', { id: 'starter', version: '1.2.0' }],
    ] as const) {
      expect((await call(path, body)).status, path).toBe(200)
    }
    const rows = (await logRows()).length
    expect(rows).toBe(5)
    // The sixth, over the two routes together.
    for (const [path, body] of [
      ['/micelio/themes/revert', {}],
      ['/micelio/themes/activate', { id: 'bogota' }],
    ] as const) {
      const refused = await call(path, body)
      expect(refused.status, path).toBe(429)
      expect(refused.headers.get('content-type')).toContain('application/problem+json')
      const wait = Number(refused.headers.get('retry-after'))
      expect(wait, path).toBeGreaterThan(0)
      expect(wait, path).toBeLessThanOrEqual(60)
      expect(await refused.json()).toMatchObject({ status: 429, code: 'themeChangeLimited' })
    }
    expect(await pinOf('default')).toEqual({
      themeId: 'starter',
      themeVersion: null,
      themeDigest: null,
    })
    expect(await logRows()).toHaveLength(rows)
    // Another admin user is not held back by the first one's count.
    await login('strapi-super-admin')
    expect((await call('/micelio/themes/revert', {})).status).toBe(200)
    expect(await logRows()).toHaveLength(rows + 1)
  })
})
