import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'
import { exportArchive, rewrite, tar, untar } from './site-archive'

const LANDING = 'api::landing.landing' as UID.ContentType
const STORY = 'api::story.story' as UID.ContentType
const BULLETIN = 'api::bulletin.bulletin' as UID.ContentType
const SETTING = 'plugin::micelio.block-setting' as UID.ContentType
const PASSWORD = 'Password1234'
type Grant = string | { action: string; subject: string; properties: Record<string, unknown> }
const action = (grant: Grant) =>
  typeof grant === 'string'
    ? { action: grant, subject: null, properties: {}, conditions: [] }
    : { ...grant, conditions: [] }

interface Problem {
  status: number
  code: string
  detail: string
  block?: string
  option?: string
  allowed?: string[]
  reason?: string
  field?: string
}

interface MergedBlock {
  id: string
  options: Record<string, { values: string[]; default: string; coreDefault: string }>
  label: Record<string, string>
  pageTypes: string[]
}

// The per-site management of the catalogue (#51): what a site disables or configures is enforced on
// every path that writes content, the defaults stay inside the contract, and `GET /micelio/blocks?site=`
// answers the merged view the palette reads.
describe('the block catalogue of a site', () => {
  let strapi: Core.Strapi
  let base: string
  let token: string
  const admins: Record<string, string> = {}
  const sites = new Map<string, string>()

  async function createUser(email: string, actions: Grant[] | 'super'): Promise<void> {
    const roles = strapi.service('admin::role')
    const role =
      actions === 'super'
        ? await strapi.db.query('admin::role').findOne({ where: { code: 'strapi-super-admin' } })
        : await roles.create({ name: email, description: email })
    if (actions !== 'super') await roles.assignPermissions(role.id, actions.map(action))
    await strapi.service('admin::user').create({
      email,
      firstname: 'Editor',
      lastname: email.split('@')[0],
      password: PASSWORD,
      roles: [role.id],
      isActive: true,
    })
    const response = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    admins[email] = ((await response.json()) as { data: { token: string } }).data.token
  }

  const admin = (who: string, path: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init
    return fetch(`${base}/micelio${path}`, {
      ...rest,
      headers: {
        Authorization: `Bearer ${admins[who]}`,
        ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: json === undefined ? rest.body : JSON.stringify(json),
    })
  }

  const setting = (who: string, block: string, json: unknown, site = 'default') =>
    admin(who, `/block-settings/${block}?site=${site}`, { method: 'PUT', json })

  const merged = async (site = 'default'): Promise<MergedBlock[]> =>
    (
      (await (await admin('root@example.com', `/blocks?site=${site}`)).json()) as {
        data: MergedBlock[]
      }
    ).data

  const rest = (method: string, path: string, sections: unknown[], site = 'default') =>
    fetch(`${base}/api/landings${path}?status=draft&site=${site}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: { title: 'A page', sections } }),
    })

  async function problem(response: Response, status = 400): Promise<Problem> {
    expect(response.status).toBe(status)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    return (await response.json()) as Problem
  }

  const grid = { __component: 'section.feature-grid', columns: 3 }
  const logos = { __component: 'section.logo-cloud', columns: 4 }

  async function reset(): Promise<void> {
    await strapi.db.query(SETTING).deleteMany({})
    await strapi.db.query(LANDING).deleteMany({})
    await strapi.db.query(STORY).deleteMany({})
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    base = `http://127.0.0.1:${(strapi.server.httpServer.address() as AddressInfo).port}`
    token = (
      (await strapi.service('admin::api-token').create({
        name: 'block-settings',
        type: 'full-access',
        lifespan: null,
      })) as { accessKey: string }
    ).accessKey
    const siteService = strapi.documents(SITE_UID as UID.ContentType)
    const other = await siteService.create({
      data: { name: 'Other', slug: 'other', modules: {} } as never,
    })
    sites.set('other', other.documentId)
    sites.set(
      'default',
      (await siteService.findFirst({ filters: { slug: 'default' } }))!.documentId
    )
    await createUser('root@example.com', 'super')
    await createUser('reader@example.com', ['plugin::micelio.blocks.read'])
    await createUser('manager@example.com', [
      'plugin::micelio.blocks.read',
      'plugin::micelio.blocks.manage',
    ])
    await createUser('plain@example.com', [])
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  describe('who may', () => {
    it('registers the two permissions', async () => {
      const actions = (await strapi.service('admin::permission').actionProvider.values()) as {
        actionId: string
      }[]
      const ids = actions.map(({ actionId }) => actionId)
      expect(ids).toContain('plugin::micelio.blocks.read')
      expect(ids).toContain('plugin::micelio.blocks.manage')
    })

    it('lets a reader read the page but not write', async () => {
      expect((await admin('reader@example.com', '/block-settings?site=default')).status).toBe(200)
      expect((await setting('reader@example.com', 'hero', { enabled: false })).status).toBe(403)
      const denied = await problem(
        await admin('reader@example.com', '/block-settings/hero?site=default', {
          method: 'DELETE',
        }),
        403
      )
      expect(denied.code).toBe('blocksForbidden')
    })

    it('refuses a role with neither permission, in every route of the page', async () => {
      for (const [path, init] of [
        ['/block-settings?site=default', {}],
        ['/block-settings/hero/usage?site=default', {}],
        ['/block-settings/hero?site=default', { method: 'PUT', json: { enabled: false } }],
        ['/block-settings/hero?site=default', { method: 'DELETE' }],
      ] as const) {
        expect((await admin('plain@example.com', path, init)).status).toBe(403)
      }
    })

    it('lets a manager write, and answers an unknown site as unknownSite', async () => {
      expect((await setting('manager@example.com', 'hero', { enabled: true })).status).toBe(200)
      const missing = await problem(
        await admin('manager@example.com', '/block-settings?site=nowhere'),
        404
      )
      expect(missing.code).toBe('unknownSite')
      const view = await problem(await admin('root@example.com', '/blocks?site=nowhere'), 404)
      expect(view.code).toBe('unknownSite')
      await reset()
    })
  })

  describe('the type that stores the settings', () => {
    it('is hidden from the Content Manager, is site-scoped, is never exported and has no content API route', async () => {
      const schema = strapi.contentType(SETTING as never) as {
        pluginOptions?: Record<string, unknown>
        attributes: Record<string, { type?: string; target?: string }>
      }
      expect(schema.pluginOptions?.['content-manager']).toEqual({ visible: false })
      expect(schema.pluginOptions?.['content-type-builder']).toEqual({ visible: false })
      expect(schema.pluginOptions?.micelio).toMatchObject({ export: 'never', siteScoped: true })
      expect(schema.attributes.site).toMatchObject({
        type: 'relation',
        target: 'plugin::micelio.site',
      })
      for (const path of ['/api/block-settings', '/api/micelio/block-settings']) {
        const response = await fetch(`${base}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        expect(response.status).toBe(404)
      }
    })
  })

  describe('disabling a block', () => {
    it('removes it from the merged view, refuses it at save with blockNotAllowed and writes nothing', async () => {
      expect((await merged()).map(({ id }) => id)).toContain('feature-grid')
      expect(
        (await setting('manager@example.com', 'feature-grid', { enabled: false })).status
      ).toBe(200)
      const blocks = await merged()
      expect(blocks.map(({ id }) => id)).not.toContain('feature-grid')
      expect(blocks.map(({ id }) => id)).toContain('logo-cloud')

      const refused = await problem(await rest('POST', '', [grid]))
      expect(refused).toMatchObject({
        code: 'blockNotAllowed',
        block: 'feature-grid',
        reason: 'disabled',
      })
      expect(refused.detail).toContain('feature-grid')
      expect(await strapi.db.query(LANDING).count({})).toBe(0)
      // The others still insert.
      expect((await rest('POST', '', [logos])).status).toBe(201)
    })

    it('leaves another site alone', async () => {
      expect((await merged('other')).map(({ id }) => id)).toContain('feature-grid')
      const created = await rest('POST', '', [grid], 'other')
      expect(created.status).toBe(201)
    })

    it('keeps serving the catalogue with no site as the contract, unmerged', async () => {
      const response = await admin('root@example.com', '/blocks')
      const { data } = (await response.json()) as { data: { id: string }[] }
      expect(data.map(({ id }) => id)).toContain('feature-grid')
    })

    it('refuses an update that adds the block, and an update that adds one more of it', async () => {
      await reset()
      const created = await rest('POST', '', [grid])
      expect(created.status).toBe(201)
      const { data } = (await created.json()) as { data: { documentId: string } }
      await setting('manager@example.com', 'feature-grid', { enabled: false })
      // A page that already uses the block keeps being saved: the title, the order, the block itself.
      const edit = await rest('PUT', `/${data.documentId}`, [
        { __component: 'section.logo-cloud', columns: 4 },
        { __component: 'section.feature-grid', columns: 2 },
      ])
      expect(edit.status).toBe(200)
      const more = await problem(await rest('PUT', `/${data.documentId}`, [grid, grid]))
      expect(more).toMatchObject({ code: 'blockNotAllowed', block: 'feature-grid' })
    })

    it('keeps rendering the pages that use it: the content API still answers them', async () => {
      const list = await fetch(`${base}/api/landings?status=draft&populate=sections`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const { data } = (await list.json()) as { data: { sections: { __component: string }[] }[] }
      expect(data[0]!.sections.map((section) => section.__component)).toContain(
        'section.feature-grid'
      )
    })

    it('resets to the core defaults: the block is back and may be inserted', async () => {
      const reset204 = await admin(
        'manager@example.com',
        '/block-settings/feature-grid?site=default',
        {
          method: 'DELETE',
        }
      )
      expect(reset204.status).toBe(204)
      expect((await merged()).map(({ id }) => id)).toContain('feature-grid')
      expect((await rest('POST', '', [grid])).status).toBe(201)
      await reset()
    })
  })

  describe('on every path that writes', () => {
    beforeAll(async () => {
      await setting('manager@example.com', 'feature-grid', { enabled: false })
      await setting('manager@example.com', 'quote', { enabled: false })
    })
    afterAll(reset)

    const site = () => sites.get('default')!

    it('the document service: create and update', async () => {
      await expect(
        strapi.documents(LANDING).create({
          locale: 'en',
          data: { title: 'T', sections: [grid], site: site() } as never,
        })
      ).rejects.toMatchObject({ details: { code: 'blockNotAllowed', block: 'feature-grid' } })
      const page = await strapi.documents(LANDING).create({
        locale: 'en',
        data: { title: 'T', sections: [logos], site: site() } as never,
      })
      await expect(
        strapi.documents(LANDING).update({
          documentId: page.documentId,
          locale: 'en',
          data: { sections: [logos, grid] } as never,
        })
      ).rejects.toMatchObject({ details: { code: 'blockNotAllowed' } })
    })

    it('the Content Manager: an admin write is checked like a REST one', async () => {
      const response = await fetch(
        `${base}/content-manager/collection-types/api::landing.landing`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${admins['root@example.com']}`,
          },
          body: JSON.stringify({
            title: 'CM',
            sections: [grid],
            site: { connect: [{ documentId: site() }] },
          }),
        }
      )
      expect(response.status).toBe(400)
      expect(JSON.stringify(await response.json())).toContain('blockNotAllowed')
    })

    it('a clone is checked in full, since it starts from nothing', async () => {
      const page = await strapi.documents(LANDING).create({
        locale: 'en',
        data: { title: 'Source', sections: [logos], site: site() } as never,
      })
      await expect(
        strapi.documents(LANDING).clone({
          documentId: page.documentId,
          locale: 'en',
          data: { title: 'Copy', sections: [grid] } as never,
        })
      ).rejects.toMatchObject({ details: { code: 'blockNotAllowed', block: 'feature-grid' } })
      const copy = await strapi.documents(LANDING).clone({
        documentId: page.documentId,
        locale: 'en',
        data: { title: 'Copy', sections: [logos] } as never,
      })
      expect(copy).toBeTruthy()
    })

    it('another type with its own dynamic zone: a disabled article block', async () => {
      await expect(
        strapi.documents(STORY).create({
          locale: 'en',
          data: {
            title: 'Story',
            blocks: [{ __component: 'shared.quote', text: 'x' }],
            site: site(),
          } as never,
        })
      ).rejects.toMatchObject({ details: { code: 'blockNotAllowed', block: 'quote' } })
    })

    it('an import refuses the archive before it writes, in the dry run too', async () => {
      await setting('manager@example.com', 'logo-cloud', { enabled: true })
      const created = await strapi.documents(LANDING).create({
        locale: 'en',
        data: { title: 'Held', sections: [logos], site: site() } as never,
      })
      const archive = await exportArchive(strapi)
      await strapi.db.query(LANDING).deleteMany({})
      await setting('manager@example.com', 'logo-cloud', { enabled: false })
      const service = strapi.plugin('micelio').service('siteExport')
      for (const run of [
        () => service.preview(Readable.from([archive]), { into: 'default' }),
        () => service.import(Readable.from([archive]), { into: 'default' }),
      ]) {
        await expect(run()).rejects.toThrow(/logo-cloud block is disabled on the target site/)
      }
      expect(await strapi.db.query(LANDING).count({})).toBe(0)
      // Enabled again, the same archive imports.
      await setting('manager@example.com', 'logo-cloud', { enabled: true })
      await service.import(Readable.from([archive]), { into: 'default' })
      expect(
        await strapi.db.query(LANDING).count({ where: { documentId: created.documentId } })
      ).toBeGreaterThan(0)
    })
  })

  // A page that holds a block the site disables afterwards: what a copy, a move and a re-save of it do.
  describe('a page that already holds a disabled block', () => {
    const site = () => sites.get('default')!
    const panel = { inner: { columns: '3' } }
    let page: string
    let nested: string
    let moved: string

    beforeAll(async () => {
      await createUser('untitled-reader@example.com', [
        'plugin::micelio.blocks.read',
        {
          action: 'plugin::content-manager.explorer.read',
          subject: LANDING,
          properties: { fields: ['sections', 'site', 'panel'], locales: ['en'] },
        },
      ])
      await createUser('landing-reader@example.com', [
        'plugin::micelio.blocks.read',
        {
          action: 'plugin::content-manager.explorer.read',
          subject: LANDING,
          properties: { fields: ['title', 'sections', 'site', 'panel'], locales: ['en'] },
        },
      ])
      page = (
        await strapi.documents(LANDING).create({
          locale: 'en',
          data: { title: 'Holder', sections: [grid], site: site() } as never,
        })
      ).documentId
      nested = (
        await strapi.documents(LANDING).create({
          locale: 'en',
          data: { title: 'Nested', panel, site: site() } as never,
        })
      ).documentId
      moved = (
        await strapi.documents(LANDING).create({
          locale: 'en',
          data: { title: 'Elsewhere', sections: [grid], site: sites.get('other')! } as never,
        })
      ).documentId
      await strapi.documents(STORY).create({
        locale: 'en',
        data: {
          title: 'Story',
          blocks: [{ __component: 'shared.quote', text: 'x' }],
          site: site(),
        } as never,
      })
      await setting('manager@example.com', 'feature-grid', { enabled: false })
      await setting('manager@example.com', 'quote', { enabled: false })
    })
    afterAll(reset)

    it('refuses a clone that names no blocks, since it copies the source', async () => {
      await expect(
        strapi.documents(LANDING).clone({
          documentId: page,
          locale: 'en',
          data: { title: 'Copy' } as never,
        })
      ).rejects.toMatchObject({ details: { code: 'blockNotAllowed', block: 'feature-grid' } })
      await expect(
        strapi.documents(LANDING).clone({ documentId: page } as never)
      ).rejects.toMatchObject({ details: { code: 'blockNotAllowed' } })
    })

    it("refuses the Content Manager's duplicate", async () => {
      const response = await fetch(
        `${base}/content-manager/collection-types/api::landing.landing/auto-clone/${page}`,
        { method: 'POST', headers: { Authorization: `Bearer ${admins['root@example.com']}` } }
      )
      expect(response.status).toBe(400)
      expect(JSON.stringify(await response.json())).toContain('blockNotAllowed')
      expect(await strapi.db.query(LANDING).count({ where: { title: 'Holder' } })).toBe(1)
    })

    it('refuses a page moved to a site that disabled its block, with or without blocks in the data', async () => {
      await expect(
        strapi.documents(LANDING).update({
          documentId: moved,
          locale: 'en',
          data: { site: site() } as never,
        })
      ).rejects.toMatchObject({ details: { code: 'blockNotAllowed', block: 'feature-grid' } })
      await expect(
        strapi.documents(LANDING).update({
          documentId: moved,
          locale: 'en',
          data: { site: site(), sections: [grid] } as never,
        })
      ).rejects.toMatchObject({ details: { code: 'blockNotAllowed' } })
      const stored = await strapi.documents(LANDING).findOne({
        documentId: moved,
        locale: 'en',
        status: 'draft',
        populate: { site: true },
      })
      expect((stored as unknown as { site: { slug: string } }).site.slug).toBe('other')
    })

    it('keeps saving a page whose disabled block is nested in a component', async () => {
      const saved = await strapi.documents(LANDING).update({
        documentId: nested,
        locale: 'en',
        data: { title: 'Nested again', panel } as never,
      })
      expect(saved!.title).toBe('Nested again')
    })

    it('counts the nested block, and lists it with the pages that hold it', async () => {
      const usage = async (who: string, block: string) =>
        (
          (await (await admin(who, `/block-settings/${block}/usage?site=default`)).json()) as {
            data: { title: string; state: string }[]
          }
        ).data
      const titles = (await usage('root@example.com', 'feature-grid')).map((entry) => entry.title)
      expect(titles).toEqual(['Holder', 'Nested again'])
      const view = (await (
        await admin('reader@example.com', '/block-settings?site=default')
      ).json()) as {
        data: { blocks: { id: string; used: number }[] }
      }
      expect(view.data.blocks.find((block) => block.id === 'feature-grid')!.used).toBe(2)
    })

    it('lists only the pages the caller may read in the Content Manager, and still counts them all', async () => {
      const usage = async (who: string, block: string) =>
        (
          (await (await admin(who, `/block-settings/${block}/usage?site=default`)).json()) as {
            data: { title: string }[]
          }
        ).data.map((entry) => entry.title)
      expect(await usage('landing-reader@example.com', 'feature-grid')).toEqual([
        'Holder',
        'Nested again',
      ])
      expect(await usage('landing-reader@example.com', 'quote')).toEqual([])
      expect(await usage('manager@example.com', 'quote')).toEqual([])
      expect(await usage('root@example.com', 'quote')).toEqual(['Story'])
      const view = (await (
        await admin('landing-reader@example.com', '/block-settings?site=default')
      ).json()) as { data: { blocks: { id: string; used: number }[] } }
      expect(view.data.blocks.find((block) => block.id === 'quote')!.used).toBe(1)
    })

    it('is the document id for a role that may not read the title field', async () => {
      const untitled = (await (
        await admin(
          'untitled-reader@example.com',
          '/block-settings/feature-grid/usage?site=default'
        )
      ).json()) as { data: { title: string; documentId: string }[] }
      expect(untitled.data).toHaveLength(2)
      for (const entry of untitled.data) expect(entry.title).toBe(entry.documentId)
      expect(JSON.stringify(untitled)).not.toContain('Holder')
    })
  })

  describe('the page types', () => {
    afterAll(reset)

    it('a block allowed only on landing pages is refused on a page of another type', async () => {
      expect(
        (await setting('manager@example.com', 'logo-cloud', { allowedPageTypes: ['landing'] }))
          .status
      ).toBe(200)
      // The `landing` fixture has no `pageType`: its pages are `standard`.
      const refused = await problem(await rest('POST', '', [logos]))
      expect(refused).toMatchObject({
        code: 'blockNotAllowed',
        block: 'logo-cloud',
        reason: 'pageType',
      })
      expect(refused.detail).toContain('standard')
      const view = (await merged()).find(({ id }) => id === 'logo-cloud')!
      expect(view.pageTypes).toEqual(['landing'])
      expect(
        (await merged()).find(({ id }) => id === 'feature-grid')!.pageTypes.toSorted()
      ).toEqual(['landing', 'long-read', 'standard'])
    })

    it('refuses a page type the site does not have', async () => {
      const refused = await problem(
        await setting('manager@example.com', 'logo-cloud', { allowedPageTypes: ['poster'] })
      )
      expect(refused).toMatchObject({ code: 'blockSettingInvalid', field: 'allowedPageTypes' })
    })
  })

  describe('the default options', () => {
    afterAll(reset)

    it('refuses columns: 6 on a feature grid with blockOptionInvalid and stores nothing', async () => {
      const refused = await problem(
        await setting('manager@example.com', 'feature-grid', { defaultOptions: { columns: 6 } })
      )
      expect(refused).toMatchObject({
        code: 'blockOptionInvalid',
        block: 'feature-grid',
        option: 'columns',
        allowed: ['2', '3', '4'],
      })
      expect(await strapi.db.query(SETTING).count({})).toBe(0)
    })

    it('refuses an option the block does not expose, and a value of the wrong kind', async () => {
      expect(
        (
          await problem(
            await setting('manager@example.com', 'faq', { defaultOptions: { columns: 2 } })
          )
        ).allowed
      ).toEqual([])
      expect(
        (
          await setting('manager@example.com', 'feature-grid', {
            defaultOptions: { columns: ['2'] },
          })
        ).status
      ).toBe(400)
    })

    it('takes columns: 2 as what a new block starts with, and keeps the core default beside it', async () => {
      expect(
        (await setting('manager@example.com', 'feature-grid', { defaultOptions: { columns: 2 } }))
          .status
      ).toBe(200)
      const grid = (await merged()).find(({ id }) => id === 'feature-grid')!
      expect(grid.options.columns).toMatchObject({
        default: '2',
        coreDefault: '3',
        values: ['2', '3', '4'],
      })
      // Another option and another site keep the core's.
      expect(grid.options.density!.default).toBe('comfortable')
      expect(
        (await merged('other')).find(({ id }) => id === 'feature-grid')!.options.columns!.default
      ).toBe('3')
    })

    it('accepts columns: 6 on a logo cloud, the one block that offers it', async () => {
      expect(
        (await setting('manager@example.com', 'logo-cloud', { defaultOptions: { columns: '6' } }))
          .status
      ).toBe(200)
    })

    it('refuses a write to the content type itself that skips the route', async () => {
      await expect(
        strapi.documents(SETTING).create({
          data: {
            block: 'feature-grid',
            site: sites.get('other'),
            defaultOptions: { columns: '6' },
          } as never,
        })
      ).rejects.toMatchObject({ details: { code: 'blockOptionInvalid' } })
      await expect(
        strapi.documents(SETTING).create({
          data: { block: 'hero', site: sites.get('default') } as never,
        })
      ).resolves.toBeTruthy()
      await expect(
        strapi.documents(SETTING).create({
          data: { block: 'hero', site: sites.get('default') } as never,
        })
      ).rejects.toMatchObject({ details: { code: 'blockSettingInvalid', field: 'block' } })
      await expect(
        strapi
          .documents(SETTING)
          .create({ data: { block: 'nope', site: sites.get('default') } as never })
      ).rejects.toMatchObject({ details: { code: 'blockSettingInvalid' } })
    })
  })

  describe('the labels', () => {
    afterAll(reset)

    it('keeps a label per locale in the merged view and drops an empty one', async () => {
      await setting('manager@example.com', 'hero', { labels: { en: 'Banner', es: 'Cabecera' } })
      expect((await merged()).find(({ id }) => id === 'hero')!.label).toEqual({
        en: 'Banner',
        es: 'Cabecera',
      })
      await setting('manager@example.com', 'hero', { labels: { en: 'Banner', es: '  ' } })
      expect((await merged()).find(({ id }) => id === 'hero')!.label).toEqual({ en: 'Banner' })
    })

    it('refuses a locale the plugin does not translate and a label that is too long', async () => {
      expect(
        (await problem(await setting('manager@example.com', 'hero', { labels: { fr: 'x' } }))).code
      ).toBe('blockSettingInvalid')
      expect(
        (
          await problem(
            await setting('manager@example.com', 'hero', { labels: { en: 'x'.repeat(61) } })
          )
        ).field
      ).toBe('labels')
    })

    it('refuses a body with a field it does not take', async () => {
      expect(
        (await problem(await setting('manager@example.com', 'hero', { block: 'faq' }))).field
      ).toBe('body')
    })
  })

  describe('the page', () => {
    afterAll(reset)

    it('lists every block with its setting and how many pages use it, and the pages', async () => {
      await rest('POST', '', [grid, logos])
      await rest('POST', '', [grid])
      await setting('manager@example.com', 'feature-grid', { enabled: false })
      const view = (await (
        await admin('reader@example.com', '/block-settings?site=default')
      ).json()) as {
        data: {
          pageTypes: string[]
          blocks: {
            id: string
            enabled: boolean
            used: number
            costKb: number
            isIsland: boolean
          }[]
        }
      }
      expect(view.data.pageTypes.toSorted()).toEqual(['landing', 'long-read', 'standard'])
      expect(view.data.blocks).toHaveLength(19)
      const byId = new Map(view.data.blocks.map((block) => [block.id, block]))
      expect(byId.get('feature-grid')).toMatchObject({ enabled: false, used: 2 })
      expect(byId.get('logo-cloud')).toMatchObject({ enabled: true, used: 1 })
      expect(byId.get('hero')!.used).toBe(0)
      expect(byId.get('scene')!.isIsland).toBe(true)
      expect(byId.get('hero')!.costKb).toBeGreaterThan(0)

      const usage = (await (
        await admin('root@example.com', '/block-settings/feature-grid/usage?site=default')
      ).json()) as {
        data: { uid: string; title: string; state: string; documentId: string }[]
      }
      expect(usage.data).toHaveLength(2)
      expect(usage.data[0]).toMatchObject({ uid: LANDING, title: 'A page', state: 'draft' })
      // Another site's pages are not counted.
      const other = (await (
        await admin('root@example.com', '/block-settings/feature-grid/usage?site=other')
      ).json()) as { data: unknown[] }
      expect(other.data).toEqual([])
    })
  })

  // The module a block needs (#196): a site that has it off is not offered the block and cannot add it.
  describe('a block that needs a module the site has off', () => {
    const prose = { __component: 'section.rich-text', body: 'Hello' }
    const newsletter = { __component: 'section.newsletter', title: 'Join', buttonLabel: 'Go' }
    const send = (method: string, path: string, sections: unknown[], site: string) =>
      fetch(`${base}/api/bulletins${path}?status=draft&site=${site}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ data: { title: 'A bulletin', sections } }),
      })
    const modulesOf = (modules: Record<string, boolean>) =>
      strapi.documents(SITE_UID as UID.ContentType).update({
        documentId: sites.get('quiet')!,
        data: { modules } as never,
      })

    beforeAll(async () => {
      const quiet = await strapi.documents(SITE_UID as UID.ContentType).create({
        data: { name: 'Quiet', slug: 'quiet', modules: { newsletter: false } } as never,
      })
      sites.set('quiet', quiet.documentId)
    })
    afterAll(async () => {
      await strapi.db.query(BULLETIN).deleteMany({})
    })

    it('a site with the newsletter module off does not offer newsletter in GET /micelio/blocks, with the reason moduleOff', async () => {
      const entry = (await merged('quiet')).find(({ id }) => id === 'newsletter') as unknown as {
        offered: boolean
        reason: string
        module: string
        pageTypes: string[]
      }
      expect(entry).toMatchObject({
        offered: false,
        reason: 'moduleOff',
        module: 'newsletter',
        pageTypes: [],
      })
      // Another block of the same site, and the same block on a site with the module on, are offered.
      const others = await merged('quiet')
      expect(others.find(({ id }) => id === 'hero')).toMatchObject({ offered: true })
      expect((await merged('other')).find(({ id }) => id === 'newsletter')).toMatchObject({
        offered: true,
        pageTypes: expect.arrayContaining(['landing']),
      })
      // The Block catalogue page names the module.
      const view = (await (
        await admin('root@example.com', '/block-settings?site=quiet')
      ).json()) as { data: { blocks: { id: string; moduleOff: string | null }[] } }
      const rows = new Map(view.data.blocks.map((block) => [block.id, block.moduleOff]))
      expect(rows.get('newsletter')).toBe('newsletter')
      expect(rows.get('hero')).toBeNull()
    })

    it('inserting newsletter on a site with the module off is refused with blockNotAllowed naming the module, and is accepted on a site with it on', async () => {
      const refused = await problem(await send('POST', '', [newsletter], 'quiet'))
      expect(refused).toMatchObject({
        code: 'blockNotAllowed',
        block: 'newsletter',
        reason: 'moduleOff',
        module: 'newsletter',
      })
      expect(refused.detail).toContain('newsletter module')
      expect(await strapi.db.query(BULLETIN).count({})).toBe(0)
      expect((await send('POST', '', [newsletter], 'other')).status).toBe(201)
      // The refusal holds for the document service too, with no setting row stored.
      await expect(
        strapi.documents(BULLETIN).create({
          locale: 'en',
          data: { title: 'Direct', sections: [newsletter], site: sites.get('quiet')! } as never,
        })
      ).rejects.toThrow('newsletter module')
    })

    it('the dry run of an import that creates the site refuses an archive whose pages hold newsletter on a module that is off there, and the same archive imports with the module on', async () => {
      // The landing fixture does not list the newsletter block: add it to its zone for this case.
      const zone = (
        strapi.contentType(LANDING).attributes as unknown as {
          sections: { components: string[] }
        }
      ).sections.components
      zone.push('section.newsletter')
      const sitesService = strapi.documents(SITE_UID as UID.ContentType)
      try {
        const carried = await sitesService.create({
          data: { name: 'Carried', slug: 'carried', modules: {} } as never,
        })
        await strapi.documents(LANDING).create({
          locale: 'en',
          data: { title: 'Carried', sections: [newsletter], site: carried.documentId } as never,
        })
        await sitesService.update({
          documentId: carried.documentId,
          data: { modules: { newsletter: false } } as never,
        })
        const archive = await exportArchive(strapi, { site: 'carried' })
        await strapi.db.query(LANDING).deleteMany({ where: { site: { slug: 'carried' } } })
        await sitesService.delete({ documentId: carried.documentId })

        const service = strapi.plugin('micelio').service('siteExport')
        for (const run of [
          () => service.preview(Readable.from([archive])),
          () => service.import(Readable.from([archive])),
        ]) {
          await expect(run()).rejects.toThrow(
            /newsletter block needs the newsletter module, which is off on the target site/
          )
        }
        expect(await sitesService.findFirst({ filters: { slug: 'carried' } })).toBeNull()

        // The same archive with the module on in it imports.
        const files = untar(archive)
        rewrite<{ documents: { versions: { data: Record<string, unknown> }[] }[] }>(
          files,
          'content/site.json',
          (content) => {
            for (const version of content.documents[0]!.versions) {
              version.data.modules = { newsletter: true }
            }
            return content
          }
        )
        await service.import(Readable.from([tar(files)]))
        expect(await strapi.db.query(LANDING).count({ where: { site: { slug: 'carried' } } })).toBe(
          1
        )
      } finally {
        zone.splice(zone.indexOf('section.newsletter'), 1)
        await strapi.db.query(LANDING).deleteMany({})
        const left = await strapi
          .documents(SITE_UID as UID.ContentType)
          .findFirst({ filters: { slug: 'carried' } })
        if (left)
          await strapi
            .documents(SITE_UID as UID.ContentType)
            .delete({ documentId: left.documentId })
      }
    })

    it('the dry run of an update import checks the pages against the modules the archive writes to an existing site, and a skip import against the stored ones', async () => {
      const zone = (
        strapi.contentType(LANDING).attributes as unknown as {
          sections: { components: string[] }
        }
      ).sections.components
      zone.push('section.newsletter')
      const sitesService = strapi.documents(SITE_UID as UID.ContentType)
      try {
        const carried = await sitesService.create({
          data: { name: 'Carried', slug: 'carried', modules: {} } as never,
        })
        await strapi.documents(LANDING).create({
          locale: 'en',
          data: { title: 'Carried', sections: [newsletter], site: carried.documentId } as never,
        })
        await sitesService.update({
          documentId: carried.documentId,
          data: { modules: { newsletter: false } } as never,
        })
        const archive = await exportArchive(strapi, { site: 'carried' })
        // The target now: the same site, with the module on and no page.
        await strapi.db.query(LANDING).deleteMany({ where: { site: { slug: 'carried' } } })
        await sitesService.update({
          documentId: carried.documentId,
          data: { modules: { newsletter: true } } as never,
        })

        const service = strapi.plugin('micelio').service('siteExport')
        const refusal =
          /newsletter block needs the newsletter module, which is off on the target site/
        // `update` writes the archive's modules (off) before the pages: apply would refuse them.
        await expect(service.preview(Readable.from([archive]))).rejects.toThrow(refusal)
        await expect(service.import(Readable.from([archive]))).rejects.toThrow(refusal)
        // `skip` leaves the stored site alone, so the module stays on and the page is accepted.
        await expect(
          service.preview(Readable.from([archive]), { existing: 'skip' })
        ).resolves.toBeDefined()
      } finally {
        zone.splice(zone.indexOf('section.newsletter'), 1)
        await strapi.db.query(LANDING).deleteMany({})
        const left = await strapi
          .documents(SITE_UID as UID.ContentType)
          .findFirst({ filters: { slug: 'carried' } })
        if (left) await sitesService.delete({ documentId: left.documentId })
      }
    })

    it('a page that already holds newsletter saves a change to another block after the module is turned off', async () => {
      await modulesOf({ newsletter: true })
      const created = await strapi.documents(BULLETIN).create({
        locale: 'en',
        data: { title: 'Holder', sections: [newsletter], site: sites.get('quiet')! } as never,
      })
      await modulesOf({ newsletter: false })
      const response = await send('PUT', `/${created.documentId}`, [newsletter, prose], 'quiet')
      expect(response.status).toBe(200)
      // Adding a second newsletter is still refused.
      const again = await problem(
        await send('PUT', `/${created.documentId}`, [newsletter, newsletter], 'quiet')
      )
      expect(again).toMatchObject({ code: 'blockNotAllowed', reason: 'moduleOff' })
    })
  })
})
