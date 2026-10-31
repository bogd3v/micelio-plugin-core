import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { STATUS_REFRESH_JOB } from '../../server/src/constants/extensions'
import { ensureSiteSections } from '../../server/src/extensions/site-sections'
import { registerStatusRefresh } from '../../server/src/status/refresh'
import type { ExtensionRegistry } from '../../server/src/extensions'
import type { StatusReport } from '../../server/src/types/status'
import { cleanupStrapi, setupStrapi } from './harness'
import { exportArchive, jsonOf, rewrite, sha256, tar, untar, type Manifest } from './site-archive'

const PASSWORD = 'Password1234'
const READ = 'plugin::extension-fixture.read'
const MANAGE = 'plugin::extension-fixture.manage'
const STATUS_READ = 'plugin::micelio.status.read'
const SECTION = 'section_fixture_profile'

interface FixtureStore {
  runs: string[]
  members: string[]
  read: { site: string; paths: string[] }[]
}

type Role = 'super' | 'status-only' | 'fixture-reader' | 'no-sites'

interface ImportResult {
  plugins: Record<string, { imported: number; skipped: number }>
  skippedPlugins: { id: string; reason: string }[]
}

// The core's extension points against `extension-fixture`, a sibling plugin of the test app
// (test/strapi/app/src/plugins/extension-fixture/) that registers one of each.
describe('the extension points', () => {
  let strapi: Core.Strapi
  let base: string
  const tokens = {} as Record<Role, string>

  const extensions = () => strapi.plugin('micelio').service('extensions') as ExtensionRegistry
  const store = () => strapi.plugin('extension-fixture').service('store') as FixtureStore
  const sites = () => strapi.documents(SITE_UID as UID.ContentType)

  async function createUser(role: Role, permissions: object[] | 'super'): Promise<void> {
    const roles = strapi.service('admin::role')
    const found =
      permissions === 'super'
        ? await strapi.db.query('admin::role').findOne({ where: { code: 'strapi-super-admin' } })
        : await roles.create({ name: role, description: role })
    if (permissions !== 'super') await roles.assignPermissions(found.id, permissions)
    const email = `${role}@example.com`
    await strapi.service('admin::user').create({
      email,
      firstname: role,
      lastname: 'Test',
      password: PASSWORD,
      roles: [found.id],
      isActive: true,
    })
    const response = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    tokens[role] = ((await response.json()) as { data: { token: string } }).data.token
  }

  const action = (name: string) => ({ action: name, subject: null, properties: {}, conditions: [] })
  const siteRead = {
    action: 'plugin::content-manager.explorer.read',
    subject: SITE_UID,
    properties: { fields: ['name', 'slug'] },
    conditions: [],
  }

  function get(path: string, role?: Role): Promise<Response> {
    return fetch(`${base}${path}`, {
      headers: role ? { Authorization: `Bearer ${tokens[role]}` } : {},
    })
  }

  function post(path: string, role: Role): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens[role]}` },
    })
  }

  async function status(role: Role): Promise<StatusReport> {
    return ((await (await get('/micelio/status', role)).json()) as { data: StatusReport }).data
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    base = `http://127.0.0.1:${(strapi.server.httpServer.address() as AddressInfo).port}`
    await createUser('super', 'super')
    await createUser('status-only', [action(STATUS_READ), siteRead])
    await createUser('fixture-reader', [action(STATUS_READ), action(READ), siteRead])
    await createUser('no-sites', [action(STATUS_READ), action(READ)])
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  describe('registration', () => {
    const page = {
      id: 'other',
      group: 'content' as const,
      label: { en: 'Other', es: 'Otra' },
      to: 'other',
      permission: READ,
    }

    it('refuses a malformed registration, naming the problem', () => {
      expect(() => extensions().registerAdminPage({ ...page, id: 'Not Valid' })).toThrow(
        /registerAdminPage: id must be lower case/
      )
      expect(() => extensions().registerAdminPage({ ...page, permission: '' })).toThrow(
        /permission must name an admin permission/
      )
      expect(() =>
        extensions().registerExportSection({
          id: 'x',
          version: '1',
          personalData: false,
          permission: READ,
          write: async function* () {},
          read: async () => ({ imported: 0, skipped: 0 }),
        })
      ).toThrow(/version must be "major.minor"/)
    })

    it('refuses an id or a path that is taken', () => {
      expect(() => extensions().registerAdminPage({ ...page, id: 'fixture-page' })).toThrow(
        /"fixture-page" is already registered/
      )
      expect(() => extensions().registerAdminPage({ ...page, to: 'fixture' })).toThrow(
        /to "fixture" is already taken/
      )
    })

    it('refuses a path the core uses for its own pages', () => {
      expect(() => extensions().registerAdminPage({ ...page, id: 'other', to: 'about' })).toThrow(
        /to "about" is reserved by the core/
      )
    })

    it('leaves the path of the Export and import page to the core, and `export-import` to a sibling', () => {
      expect(() =>
        extensions().registerAdminPage({ ...page, id: 'core-path', to: '_export-import' })
      ).toThrow(/lower case letters, digits, hyphens/)
      expect(() =>
        extensions().registerAdminPage({ ...page, id: 'sibling-export', to: 'export-import' })
      ).not.toThrow()
    })

    it('refuses a site section once the models are built, and one with an unknown component', () => {
      const section = {
        id: 'late',
        component: 'extension-fixture.profile',
        label: { en: 'Late', es: 'Tarde' },
        panel: 'late',
        permission: READ,
      }
      expect(() =>
        extensions().registerSiteSection({ ...section, component: 'nope.nothing' })
      ).toThrow(/component "nope.nothing" is not registered/)
      expect(() => extensions().registerSiteSection(section)).toThrow(/call it in `register`/)
    })

    it('accepts a text without Spanish and shows the page with its English label', async () => {
      extensions().registerAdminPage({
        ...page,
        id: 'english-only',
        to: 'english-only',
        label: { en: 'English only' } as never,
      })
      const { data } = (await (await get('/micelio/admin-pages', 'super')).json()) as {
        data: { id: string; label: { en: string } }[]
      }
      expect(data.find(({ id }) => id === 'english-only')?.label.en).toBe('English only')
    })
  })

  describe('the sub-navigation items', () => {
    const idsFor = async (role: Role): Promise<string[]> =>
      ((await (await get('/micelio/admin-pages', role)).json()) as { data: { id: string }[] }).data
        .filter(({ id }) => id === 'fixture-page')
        .map(({ id }) => id)

    it('lists an item with its group, label and path for a role that has its permission', async () => {
      const { data } = (await (await get('/micelio/admin-pages', 'fixture-reader')).json()) as {
        data: object[]
      }
      expect(data).toContainEqual({
        id: 'fixture-page',
        group: 'site',
        label: { en: 'Fixture page', es: 'Página de prueba' },
        to: 'fixture',
      })
    })

    it('hides it from a role without the permission, and from a caller with no token', async () => {
      expect(await idsFor('super')).toEqual(['fixture-page'])
      expect(await idsFor('status-only')).toEqual([])
      expect((await get('/micelio/admin-pages')).status).toBe(401)
    })
  })

  describe('the site sections', () => {
    it('creates the instance of a section with the site, and keeps what the creator gave', async () => {
      const created = await sites().create({
        data: { name: 'Blog', slug: 'blog', hosts: ['blog.example.com'], modules: {} } as never,
      })
      const row = (await strapi.db.query(SITE_UID as UID.ContentType).findOne({
        where: { documentId: created.documentId },
        populate: { [SECTION]: true },
      })) as Record<string, { handle: string } | null>
      expect(row[SECTION]?.handle).toBe('unset')

      const given = await sites().create({
        data: { name: 'Shop', slug: 'shop', modules: {}, [SECTION]: { handle: '@shop' } } as never,
      })
      const kept = (await strapi.db.query(SITE_UID as UID.ContentType).findOne({
        where: { documentId: given.documentId },
        populate: { [SECTION]: true },
      })) as Record<string, { handle: string } | null>
      expect(kept[SECTION]?.handle).toBe('@shop')
    })

    it('gives the sites that have none an instance at boot, and only once', async () => {
      await strapi.db.query(SITE_UID as UID.ContentType).create({
        data: {
          name: 'Old',
          slug: 'old',
          locale: 'en',
          modules: null,
          isDefault: false,
          defaultLocale: 'en',
          documentId: 'old-site-document',
        },
      })
      expect(await ensureSiteSections(strapi)).toBe(1)
      expect(await ensureSiteSections(strapi)).toBe(0)
    })

    it('answers the section in GET /micelio/sites only with its permission', async () => {
      const read = async (role: Role) =>
        (
          (await (await get('/micelio/sites', role)).json()) as {
            data: { slug: string; sections: Record<string, { handle: string } | null> }[]
          }
        ).data

      const allowed = await read('fixture-reader')
      expect(allowed.map(({ slug }) => slug)).toEqual(['default', 'blog', 'old', 'shop'])
      expect(allowed.find(({ slug }) => slug === 'shop')?.sections['fixture-profile']?.handle).toBe(
        '@shop'
      )
      expect(
        allowed.find(({ slug }) => slug === 'default')?.sections['fixture-profile']?.handle
      ).toBe('unset')

      for (const site of await read('status-only')) expect(site.sections).toEqual({})
    })

    it('keeps the section out of the content API, whatever the populate', async () => {
      const { accessKey } = (await strapi.service('admin::api-token').create({
        name: 'extensions-suite',
        type: 'full-access',
        lifespan: null,
      })) as { accessKey: string }
      const response = await fetch(`${base}/api/micelio/sites?populate=*`, {
        headers: { Authorization: `Bearer ${accessKey}` },
      })
      expect(response.status).toBe(200)
      const { data } = (await response.json()) as { data: Record<string, unknown>[] }
      expect(data.length).toBeGreaterThan(0)
      for (const site of data)
        expect(Object.keys(site).filter((key) => key === SECTION)).toEqual([])
    })

    it('refuses the list to a role that cannot read sites', async () => {
      const response = await get('/micelio/sites', 'no-sites')
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'sitesForbidden' })
      expect((await get('/micelio/sites')).status).toBe(401)
    })
  })

  describe('the status checks', () => {
    it('does not run them when the status is read', async () => {
      const before = store().runs.length
      const report = await status('super')
      expect(store().runs).toHaveLength(before)
      expect(report.plugins['fixture-checks']).toEqual({
        label: { en: 'Fixture checks', es: 'Comprobaciones de prueba' },
        ranAt: null,
        checks: [],
      })
    })

    it('runs them for every site on Run again, and answers two checks per site', async () => {
      store().runs.length = 0
      expect((await post('/micelio/status/host-check', 'super')).status).toBe(200)
      expect([...store().runs].sort()).toEqual(['blog', 'default', 'old', 'shop'])

      const report = await status('fixture-reader')
      const result = report.plugins['fixture-checks']!
      expect(result.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(result.checks).toHaveLength(8)
      const blog = report.sites.find(({ slug }) => slug === 'blog')!
      expect(result.checks.filter(({ site }) => site === blog.documentId)).toEqual([
        {
          id: 'reachable',
          title: { en: 'The fixture answers', es: 'La prueba responde' },
          status: 'ok',
          site: blog.documentId,
        },
        {
          id: 'handle',
          title: { en: 'The fixture has a handle', es: 'La prueba tiene un alias' },
          status: 'warn',
          detail: { en: 'Site blog has no handle.', es: 'El sitio blog no tiene alias.' },
          fix: { en: 'Set a handle.', es: 'Define un alias.' },
          site: blog.documentId,
        },
      ])
    })

    it("shows a plugin's checks only to a role that has its permission", async () => {
      expect(Object.keys((await status('status-only')).plugins)).toEqual([])
      expect(Object.keys((await status('super')).plugins)).toEqual(['fixture-checks'])
    })

    it('reports a check that throws as a failed check and keeps the others', async () => {
      extensions().registerStatusChecks({
        id: 'broken',
        label: { en: 'Broken', es: 'Rota' },
        permission: READ,
        run: () => {
          throw new Error('secret path /srv/app')
        },
      })
      const error = vi.spyOn(strapi.log, 'error')
      await post('/micelio/status/host-check', 'super')
      const report = await status('super')
      expect(report.plugins['fixture-checks']!.checks).toHaveLength(8)
      const broken = report.plugins.broken!.checks
      expect(broken).toHaveLength(4)
      expect(broken[0]).toMatchObject({ id: 'run', status: 'fail' })
      // The cause is in the log, not in the answer.
      expect(JSON.stringify(report)).not.toContain('/srv/app')
      expect(error).toHaveBeenCalledWith(expect.stringContaining('secret path /srv/app'))
      error.mockRestore()
    })

    it('runs them again on the daily refresh, and not when its rule is false', async () => {
      const add = vi.spyOn(strapi.cron, 'add')
      expect(registerStatusRefresh(strapi)).toBe(true)
      const job = (
        add.mock.calls[0]![0] as Record<
          string,
          { task: () => Promise<void>; options: { rule: string } }
        >
      )[STATUS_REFRESH_JOB]!
      expect(job.options.rule).toBe('0 4 * * *')
      store().runs.length = 0
      await job.task()
      expect(store().runs).toHaveLength(4)

      add.mockClear()
      const get = vi.spyOn(strapi.config, 'get').mockReturnValue(false)
      expect(registerStatusRefresh(strapi)).toBe(false)
      expect(add).not.toHaveBeenCalled()
      get.mockRestore()
      add.mockRestore()
    })
  })

  describe('the export sections', () => {
    const exportRequest = (request: object = {}) =>
      exportArchive(strapi, { site: 'blog', ...request })

    it('leaves a section with personal data out by default', async () => {
      const files = untar(await exportRequest())
      const manifest = jsonOf<Manifest & { plugins: unknown[] }>(files, 'manifest.json')
      expect(manifest.plugins).toEqual([])
      expect(manifest.personal).toBe(false)
      expect([...files.keys()].some((name) => name.startsWith('plugins/'))).toBe(false)
    })

    it('still carries a site section with the site, though the content API hides it', async () => {
      const files = untar(await exportRequest())
      const site = jsonOf<{ documents: { versions: { data: Record<string, unknown> }[] }[] }>(
        files,
        'content/site.json'
      )
      expect(site.documents[0]?.versions[0]?.data[SECTION]).toMatchObject({ handle: 'unset' })
    })

    it('includes it when asked for by id, with its version in the manifest, and logs it', async () => {
      const info = vi.spyOn(strapi.log, 'info')
      const files = untar(await exportRequest({ include: ['fixture-members'] }))
      const manifest = jsonOf<Manifest & { plugins: object[] }>(files, 'manifest.json')
      expect(manifest.formatVersion).toBe('1.1')
      expect(manifest.plugins).toEqual([
        { id: 'fixture-members', version: '1.0', personalData: true, entries: 1 },
      ])
      expect(manifest.personal).toBe(true)
      const body = files.get('plugins/fixture-members/members.json')!
      expect(JSON.parse(body.toString())).toEqual({ site: 'blog', members: ['member@example.com'] })
      expect(manifest.files['plugins/fixture-members/members.json']).toEqual({
        sha256: sha256(body),
        bytes: body.length,
      })
      expect(info).toHaveBeenCalledWith(
        'micelio: exported the personal data of section "fixture-members" for site "blog"'
      )
      info.mockRestore()
    })

    it('refuses to include a section nobody registered', async () => {
      await expect(exportRequest({ include: ['ghost'] })).rejects.toMatchObject({
        code: 'exportSectionUnknown',
      })
    })
  })

  describe('importing sections', () => {
    const importArchive = (body: Buffer, request: object = {}) =>
      strapi
        .plugin('micelio')
        .service('siteExport')
        .import(Readable.from([body]), request) as Promise<ImportResult>

    it('hands the files of a registered section to its plugin', async () => {
      const archive = await exportArchive(strapi, { site: 'shop', include: ['fixture-members'] })
      store().read.length = 0
      const report = await importArchive(archive)
      expect(store().read).toEqual([{ site: 'shop', paths: ['members.json'] }])
      expect(report.plugins).toEqual({ 'fixture-members': { imported: 1, skipped: 0 } })
      expect(report.skippedPlugins).toEqual([])
    })

    it('reports a section nobody registered as skipped, and imports the rest', async () => {
      const files = untar(
        await exportArchive(strapi, { site: 'shop', include: ['fixture-members'] })
      )
      const body = files.get('plugins/fixture-members/members.json')!
      files.delete('plugins/fixture-members/members.json')
      files.set('plugins/ghost/ghost.json', body)
      const manifest = jsonOf<Manifest & { plugins: { id: string }[] }>(files, 'manifest.json')
      delete manifest.files['plugins/fixture-members/members.json']
      manifest.files['plugins/ghost/ghost.json'] = { sha256: sha256(body), bytes: body.length }
      manifest.plugins = [{ id: 'ghost', version: '1.0', personalData: true, entries: 1 } as never]
      files.set('manifest.json', Buffer.from(JSON.stringify(manifest)))
      store().read.length = 0

      const report = await importArchive(
        tar(new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1))))
      )
      expect(report.skippedPlugins).toEqual([{ id: 'ghost', reason: 'unknown' }])
      expect(report.plugins).toEqual({})
      expect(store().read).toEqual([])
    })

    it('skips a section of another major version', async () => {
      const files = untar(
        await exportArchive(strapi, { site: 'shop', include: ['fixture-members'] })
      )
      rewrite<{ plugins: { version: string }[] }>(files, 'manifest.json', (manifest) => {
        manifest.plugins[0]!.version = '2.0'
        return manifest
      })
      const report = await importArchive(
        tar(new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1))))
      )
      expect(report.skippedPlugins).toEqual([{ id: 'fixture-members', reason: 'version' }])
    })

    it('refuses a file under plugins/ that the manifest does not list as a section', async () => {
      const files = untar(await exportArchive(strapi, { site: 'shop' }))
      const body = Buffer.from('{}')
      files.set('plugins/stray/file.json', body)
      rewrite<Manifest>(files, 'manifest.json', (manifest) => {
        manifest.files['plugins/stray/file.json'] = { sha256: sha256(body), bytes: body.length }
        return manifest
      })
      await expect(
        importArchive(tar(new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1)))))
      ).rejects.toMatchObject({ code: 'exportArchiveCorrupt' })
    })
  })

  // Last: a registration cannot be removed, and this section makes every later export fail.
  describe('a section that writes a path an archive may not hold', () => {
    it('refuses a file whose path an archive may not hold', async () => {
      extensions().registerExportSection({
        id: 'bad-path',
        version: '1.0',
        personalData: false,
        permission: MANAGE,
        write: async function* () {
          yield { path: '../escape.json', body: '{}' }
        },
        read: async () => ({ imported: 0, skipped: 0 }),
      })
      await expect(exportArchive(strapi, { site: 'blog' })).rejects.toMatchObject({
        code: 'exportSectionFailed',
      })
    })
  })
})
