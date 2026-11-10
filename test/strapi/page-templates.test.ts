import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'

// `guide` is site-scoped, editorial and made with `withPageSettings` (test/strapi/app/src/api/guide/).
// The budgets do not list it here, so its publish is not measured and needs no frontend.
const GUIDE = 'api::guide.guide' as UID.ContentType
const TEMPLATE = 'plugin::micelio.page-template' as UID.ContentType
const SETTING = 'plugin::micelio.block-setting' as UID.ContentType
const PASSWORD = 'Password1234'
type Grant = string | { action: string; subject: string; properties: Record<string, unknown> }
const action = (grant: Grant) =>
  typeof grant === 'string'
    ? { action: grant, subject: null, properties: {}, conditions: [] }
    : { ...grant, conditions: [] }

interface Problem {
  code: string
  detail: string
  site?: string
  block?: string
  field?: string
  pageType?: string
  budgetKb?: number
  blocks?: { block: string; position: number; fields: string[] }[]
}

interface Summary {
  id: string
  name: string
  version: number
  scope: string
  kb: number
  blocks: { block: string; options: Record<string, string>; content: string; fixed: boolean }[]
  thumbnail: string[]
}

type Section = Record<string, unknown> & { __component: string }

// Page templates (#54): a page's blocks are saved as a template, a new page copies them, never links
// to them, and cannot be published while it holds the sample text it copied.
describe('page templates', () => {
  let strapi: Core.Strapi
  let base: string
  let site: string
  const admins: Record<string, string> = {}
  const guides = () => strapi.documents(GUIDE)

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
    const login = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    admins[email] = ((await login.json()) as { data: { token: string } }).data.token
  }

  const root = 'root@example.com'
  const asAdmin = (who: string, path: string, init: { method?: string; json?: unknown } = {}) =>
    fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admins[who]}` },
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    })
  const micelio = (path: string, init: { method?: string; json?: unknown } = {}, who = root) =>
    asAdmin(who, `/micelio${path}`, init)

  const move = (documentId: string, to: string) =>
    micelio('/transitions', { method: 'POST', json: { uid: GUIDE, documentId, locale: 'en', to } })

  async function problem(response: Response, status: number): Promise<Problem> {
    expect(response.status).toBe(status)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    return (await response.json()) as Problem
  }

  const sections: Section[] = [
    {
      __component: 'section.feature-grid',
      title: 'Why Micelio',
      columns: '4',
      density: 'compact',
      items: [
        { title: 'Fast', text: 'Static first.' },
        { title: 'Open', text: 'MIT licensed.' },
      ],
    },
    { __component: 'section.rich-text', body: 'Open source, in plain words.', width: 'wide' },
    { __component: 'section.logo-cloud', title: 'Used by', columns: '6' },
  ]

  /** A guide that holds `sections`, the page a template is saved from. */
  async function pageWith(blocks: Section[] = sections): Promise<string> {
    const created = await guides().create({
      locale: 'en',
      data: {
        title: 'Open source',
        slug: `page-${Math.random().toString(36).slice(2, 8)}`,
        site,
        pageType: 'landing',
        sections: blocks,
      } as never,
    })
    return created.documentId
  }

  const saveAs = (documentId: string, json: Record<string, unknown> = {}, siteSlug = 'default') =>
    micelio(`/templates?site=${siteSlug}`, {
      method: 'POST',
      json: {
        uid: GUIDE,
        documentId,
        locale: 'en',
        name: `Explainer ${Math.random().toString(36).slice(2, 8)}`,
        description: 'A grid, a text and logos.',
        scope: 'site',
        pageTypes: ['landing'],
        ...json,
      },
    })

  async function saved(json: Record<string, unknown> = {}): Promise<Summary> {
    const response = await saveAs(await pageWith(), json)
    expect(response.status).toBe(201)
    return ((await response.json()) as { data: Summary }).data
  }

  const pageFrom = (id: string, json: Record<string, unknown> = {}) =>
    micelio(`/templates/${id}/pages`, {
      method: 'POST',
      json: { uid: GUIDE, site: 'default', locale: 'en', title: 'My new page', ...json },
    })

  async function created(id: string) {
    const response = await pageFrom(id)
    expect(response.status).toBe(201)
    const { documentId } = ((await response.json()) as { data: { documentId: string } }).data
    return documentId
  }

  async function read(documentId: string) {
    return (await guides().findOne({
      documentId,
      locale: 'en',
      populate: { sections: { populate: '*' } },
    } as never)) as unknown as Record<string, unknown> & { sections: Section[] }
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    base = `http://127.0.0.1:${(strapi.server.httpServer.address() as AddressInfo).port}`
    const siteService = strapi.documents(SITE_UID as UID.ContentType)
    site = (await siteService.findFirst({ filters: { slug: 'default' } }))!.documentId
    await siteService.create({ data: { name: 'Other', slug: 'other', modules: {} } as never })
    // A second locale (#153), made before any request: creating one resets the connections already
    // open. The default site gets a Spanish version, so a page may be made there in Spanish.
    await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' })
    await siteService.update({
      documentId: site,
      locale: 'es',
      data: { name: 'Predeterminado' },
    } as never)
    await createUser(root, 'super')
    const create = { action: 'plugin::content-manager.explorer.create', subject: GUIDE }
    const read = { action: 'plugin::content-manager.explorer.read', subject: GUIDE, properties: {} }
    await createUser('manager@example.com', [
      'plugin::micelio.templates.manage',
      read,
      { ...create, properties: { fields: ['title', 'slug', 'sections'] } },
    ])
    await createUser('blind@example.com', [
      'plugin::micelio.templates.manage',
      { ...create, properties: {} },
    ])
    // A create grant names its locales, as the admin saves a role (#153).
    await createUser('creator@example.com', [
      { ...create, properties: { fields: ['title'], locales: ['en'] } },
    ])
    await createUser('writer@example.com', [
      {
        ...create,
        properties: { fields: ['title', 'slug', 'sections', 'pageType'], locales: ['en'] },
      },
    ])
    await createUser('plain@example.com', [])
    // #153: grants limited to some fields or some locales, as the Content Manager reads them.
    const manage = 'plugin::micelio.templates.manage'
    await createUser('zoneless@example.com', [
      manage,
      { ...read, properties: { fields: ['title', 'slug', 'pageType'], locales: ['en'] } },
    ])
    await createUser('untitled@example.com', [
      manage,
      { ...read, properties: { fields: ['sections'], locales: ['en'] } },
    ])
    await createUser('english@example.com', [
      {
        ...create,
        properties: { fields: ['title', 'slug', 'sections', 'pageType'], locales: ['en'] },
      },
    ])
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('registers the permission to manage templates', async () => {
    const actions = (await strapi.service('admin::permission').actionProvider.values()) as {
      actionId: string
    }[]
    expect(actions.map(({ actionId }) => actionId)).toContain('plugin::micelio.templates.manage')
  })

  it('creating from a template copies blocks and options', async () => {
    const template = await saved()
    expect(template).toMatchObject({ version: 1, scope: 'site' })
    expect(template.blocks.map(({ block }) => block)).toEqual([
      'feature-grid',
      'rich-text',
      'logo-cloud',
    ])
    expect(template.blocks[0].options).toEqual({ columns: '4', density: 'compact' })
    // The thumbnail is rendered from the structure: one shape for each block.
    expect(template.thumbnail).toEqual(['cards', 'text', 'row'])

    const page = await read(await created(template.id))
    expect(page).toMatchObject({
      title: 'My new page',
      pageType: 'landing',
      templateId: template.id,
      templateVersion: 1,
    })
    expect(page.sections.map((section) => section.__component)).toEqual([
      'section.feature-grid',
      'section.rich-text',
      'section.logo-cloud',
    ])
    expect(page.sections[0]).toMatchObject({
      columns: '4',
      density: 'compact',
      title: 'Why Micelio',
    })
    expect((page.sections[0].items as { title: string }[]).map(({ title }) => title)).toEqual([
      'Fast',
      'Open',
    ])
    expect(page.sections[1]).toMatchObject({ body: 'Open source, in plain words.' })
    expect(page.sections[2]).toMatchObject({ columns: '6' })
  })

  it('keeps no text of a block saved as clear, and none of a link or a file', async () => {
    const source = await pageWith([
      { __component: 'section.rich-text', body: 'Keep me out.' },
      { __component: 'section.feature-grid', title: 'Heading', columns: '2' },
    ])
    const response = await saveAs(source, {
      blocks: [
        { content: 'clear', fixed: true },
        { content: 'sample', fixed: false },
      ],
    })
    expect(response.status).toBe(201)
    const template = ((await response.json()) as { data: Summary }).data
    expect(template.blocks.map(({ content, fixed }) => ({ content, fixed }))).toEqual([
      { content: 'clear', fixed: true },
      { content: 'sample', fixed: false },
    ])
    const row = (await strapi.db
      .query(TEMPLATE)
      .findOne({ where: { documentId: template.id } })) as { blocks: { data: object }[] }
    expect(row.blocks[0].data).toEqual({})
    expect(JSON.stringify(row.blocks)).not.toContain('Keep me out')
    // A cleared block copies no text, so it holds no sample text to replace.
    const page = await read(await created(template.id))
    expect(page.sections[0].body ?? null).toBeNull()
    expect(page.sections[1].title).toBe('Heading')
  })

  it('editing the template afterwards does not change the page', async () => {
    const template = await saved()
    const documentId = await created(template.id)
    const before = await read(documentId)

    await strapi.documents(TEMPLATE).update({
      documentId: template.id,
      data: {
        name: 'Renamed',
        version: 2,
        blocks: [
          {
            block: 'rich-text',
            component: 'section.rich-text',
            content: 'sample',
            fixed: false,
            data: { body: 'A different text.', width: 'full' },
          },
        ],
      } as never,
    })
    await strapi.documents(TEMPLATE).delete({ documentId: template.id })

    const after = await read(documentId)
    expect(after.sections).toEqual(before.sections)
    expect(after).toMatchObject({ templateId: template.id, templateVersion: 1 })
  })

  it('publishing with sample text is refused with sampleTextPresent', async () => {
    const template = await saved()
    const documentId = await created(template.id)
    // Review is not refused: the text is replaced during it.
    expect((await move(documentId, 'in_review')).status).toBe(200)

    const refused = await problem(await move(documentId, 'published'), 409)
    expect(refused.code).toBe('sampleTextPresent')
    expect(refused.blocks?.map(({ block, position }) => ({ block, position }))).toEqual([
      { block: 'feature-grid', position: 0 },
      { block: 'rich-text', position: 1 },
      { block: 'logo-cloud', position: 2 },
    ])
    expect(refused.blocks?.[0].fields).toEqual([
      'title',
      'items[1].title',
      'items[1].text',
      'items[2].title',
      'items[2].text',
    ])
    expect(await guides().findOne({ documentId, locale: 'en', status: 'published' })).toBeNull()
    // Replacing each text lets it through.
    await guides().update({
      documentId,
      locale: 'en',
      data: {
        sections: [
          {
            __component: 'section.feature-grid',
            title: 'Our own',
            columns: '4',
            density: 'compact',
            items: [{ title: 'One', text: 'Mine.' }],
          },
          { __component: 'section.rich-text', body: 'Our words.', width: 'wide' },
          { __component: 'section.logo-cloud', title: 'Friends', columns: '6' },
        ],
      } as never,
    })
    expect((await move(documentId, 'published')).status).toBe(200)
    expect(await guides().findOne({ documentId, locale: 'en', status: 'published' })).not.toBeNull()
  })

  it('refuses to schedule a page that holds sample text, as it refuses to publish it', async () => {
    const documentId = await created((await saved()).id)
    const scheduled = await micelio('/transitions', {
      method: 'POST',
      json: {
        uid: GUIDE,
        documentId,
        locale: 'en',
        to: 'scheduled',
        publishAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    })
    expect((await problem(scheduled, 409)).code).toBe('sampleTextPresent')
    const stored = (await guides().findOne({
      documentId,
      locale: 'en',
      populate: ['editorial'],
    } as never)) as unknown as { editorial: { state: string } }
    expect(stored.editorial.state).toBe('draft')
  })

  it('publishes a page that no template made as before', async () => {
    const documentId = await pageWith()
    expect((await move(documentId, 'in_review')).status).toBe(200)
    expect((await move(documentId, 'published')).status).toBe(200)
  })

  it('a block disabled on another site keeps the template from CMS-wide scope, and the refusal names the site', async () => {
    const other = await strapi.documents(SITE_UID as UID.ContentType).findFirst({
      filters: { slug: 'other' },
    })
    await strapi.documents(SETTING).create({
      data: { block: 'logo-cloud', enabled: false, site: other!.documentId } as never,
    })
    try {
      const source = await pageWith()
      const refused = await problem(await saveAs(source, { scope: 'cms' }), 400)
      expect(refused).toMatchObject({
        code: 'templateBlockNotAllowed',
        site: 'other',
        block: 'logo-cloud',
      })
      expect(refused.detail).toContain('other')
      // Scoped to its own site the same page is a template.
      expect((await saveAs(source, { scope: 'site', name: 'Only here' })).status).toBe(201)
      // The dry run lists the failed check and refuses nothing.
      const inspected = (await (
        await micelio('/templates/inspect?site=default', {
          method: 'POST',
          json: { uid: GUIDE, documentId: source, locale: 'en', scope: 'cms' },
        })
      ).json()) as { data: { checks: { id: string; ok: boolean; detail: string }[] } }
      expect(inspected.data.checks.find(({ id }) => id === 'scope')).toMatchObject({
        ok: false,
        detail: expect.stringContaining('other'),
      })
    } finally {
      await strapi.db.query(SETTING).deleteMany({})
    }
    // Enabled everywhere, the CMS-wide scope is allowed and every site lists it.
    const global = await saved({ scope: 'cms', name: 'Everywhere' })
    const listed = (await (await micelio('/templates?site=other&uid=' + GUIDE)).json()) as {
      data: Summary[]
    }
    expect(listed.data.map(({ id }) => id)).toContain(global.id)
  })

  it('a JSON export and import equals the original', async () => {
    const original = await saved({ name: 'Round trip', description: 'Out and back.' })
    const exported = await micelio(`/templates/${original.id}/export`)
    expect(exported.status).toBe(200)
    const { data: first } = (await exported.json()) as { data: Record<string, unknown> }
    expect(first).toMatchObject({ format: 1, name: 'Round trip', version: 1, origin: 'site' })

    await strapi.documents(TEMPLATE).delete({ documentId: original.id })
    const imported = await micelio('/templates/import?site=default', {
      method: 'POST',
      json: first,
    })
    expect(imported.status).toBe(201)
    const { data: again } = (await imported.json()) as { data: Summary }
    expect(again).toMatchObject({
      name: original.name,
      version: original.version,
      scope: original.scope,
      kb: original.kb,
      blocks: original.blocks,
      thumbnail: original.thumbnail,
    })
    const second = (await (await micelio(`/templates/${again.id}/export`)).json()) as {
      data: Record<string, unknown>
    }
    expect(second.data).toEqual(first)
  })

  describe('what a template refuses', () => {
    it('refuses a second template of the name on the same site', async () => {
      const first = await saved({ name: 'Unique' })
      const refused = await problem(await saveAs(await pageWith(), { name: 'unique' }), 409)
      expect(refused.code).toBe('templateNameTaken')
      expect(first.name).toBe('Unique')
    })

    it('refuses a structure over the budget of its page type before any content', async () => {
      const heavy = await pageWith(
        Array.from({ length: 12 }, () => ({ __component: 'section.rich-text', body: 'x' }))
      )
      const refused = await problem(
        await saveAs(heavy, { name: 'Heavy', pageTypes: ['manifesto'] }),
        400
      )
      expect(refused.code).toBe('templateInvalid')
      strapi.config.set('plugin::micelio.budgets', {
        ...strapi.config.get<Record<string, unknown>>('plugin::micelio.budgets'),
        pageTypes: { landing: 10, standard: 120 },
      })
      try {
        const over = await problem(
          await saveAs(heavy, { name: 'Heavy', pageTypes: ['landing'] }),
          400
        )
        expect(over).toMatchObject({
          code: 'templateOverBudget',
          pageType: 'landing',
          budgetKb: 10,
        })
      } finally {
        strapi.config.set('plugin::micelio.budgets', {
          ...strapi.config.get<Record<string, unknown>>('plugin::micelio.budgets'),
          pageTypes: { landing: 60, standard: 120, 'long-read': 200 },
        })
      }
    })

    it('refuses an imported option the catalogue does not offer, and a document that is no template', async () => {
      const original = await saved({ name: 'Doctored' })
      const { data } = (await (await micelio(`/templates/${original.id}/export`)).json()) as {
        data: { name: string; blocks: { data: Record<string, unknown> }[] }
      }
      const doctored = { ...data, name: 'Doctored copy' }
      doctored.blocks[0].data.columns = '5'
      const refused = await problem(
        await micelio('/templates/import?site=default', { method: 'POST', json: doctored }),
        400
      )
      expect(refused).toMatchObject({ code: 'blockOptionInvalid', block: 'feature-grid' })
      const notOne = await problem(
        await micelio('/templates/import?site=default', { method: 'POST', json: { name: 'x' } }),
        400
      )
      expect(notOne).toMatchObject({ code: 'templateInvalid', field: 'format' })
    })

    it('refuses a role without the permission, and one that may not create the page type', async () => {
      const source = await pageWith()
      const body = { uid: GUIDE, documentId: source, locale: 'en', name: 'Nope', scope: 'site' }
      for (const who of ['creator@example.com', 'plain@example.com']) {
        const refused = await problem(
          await micelio('/templates?site=default', { method: 'POST', json: body }, who),
          403
        )
        expect(refused.code).toBe('templatesForbidden')
        expect((await micelio('/templates/x/export', {}, who)).status).toBe(403)
        expect(
          (await micelio('/templates/import?site=default', { method: 'POST', json: {} }, who))
            .status
        ).toBe(403)
      }
      const template = await saved()
      expect((await pageFrom(template.id)).status).toBe(201)
      const denied = await asAdmin('plain@example.com', `/micelio/templates/${template.id}/pages`, {
        method: 'POST',
        json: { uid: GUIDE, site: 'default' },
      })
      expect(denied.status).toBe(403)
      expect(
        (await asAdmin('plain@example.com', `/micelio/templates?site=default&uid=${GUIDE}`)).status
      ).toBe(403)
      // The role that creates pages lists and uses the templates but cannot save one.
      const listed = await micelio(
        `/templates?site=default&uid=${GUIDE}`,
        {},
        'creator@example.com'
      )
      expect(listed.status).toBe(200)
      // A role whose create grant lacks the fields the page writes is refused, as the Content Manager would strip them.
      const stripped = await problem(
        await micelio(
          `/templates/${template.id}/pages`,
          { method: 'POST', json: { uid: GUIDE, site: 'default', title: 'By a creator' } },
          'creator@example.com'
        ),
        403
      )
      expect(stripped.code).toBe('templatesForbidden')
      const written = await micelio(
        `/templates/${template.id}/pages`,
        { method: 'POST', json: { uid: GUIDE, site: 'default', title: 'By a writer' } },
        'writer@example.com'
      )
      expect(written.status, JSON.stringify(await written.clone().json())).toBe(201)
    })

    it('refuses to save a page of a type its manager may not read', async () => {
      const source = await pageWith()
      const body = { uid: GUIDE, documentId: source, locale: 'en', name: 'Unread', scope: 'site' }
      for (const path of ['/templates/inspect?site=default', '/templates?site=default']) {
        const refused = await problem(
          await micelio(path, { method: 'POST', json: body }, 'blind@example.com'),
          403
        )
        expect(refused.code).toBe('templatesForbidden')
      }
    })

    it('refuses to save a page whose dynamic zone its manager may not read', async () => {
      const source = await pageWith()
      const name = 'Zone unread'
      const body = { uid: GUIDE, documentId: source, locale: 'en', name, scope: 'site' }
      const refused = await problem(
        await micelio(
          '/templates?site=default',
          { method: 'POST', json: body },
          'zoneless@example.com'
        ),
        403
      )
      expect(refused.code).toBe('templatesForbidden')
      expect(await strapi.documents(TEMPLATE).findMany({ filters: { name } })).toHaveLength(0)
      // The site comes first: a page of another site is not found, whatever the role may read.
      const elsewhere = await problem(
        await micelio(
          '/templates?site=other',
          { method: 'POST', json: body },
          'zoneless@example.com'
        ),
        404
      )
      expect(elsewhere.code).toBe('templateNotFound')
    })

    it('refuses to inspect a page whose dynamic zone its manager may not read', async () => {
      const source = await pageWith()
      const body = { uid: GUIDE, documentId: source, locale: 'en', scope: 'site' }
      const refused = await problem(
        await micelio(
          '/templates/inspect?site=default',
          { method: 'POST', json: body },
          'zoneless@example.com'
        ),
        403
      )
      expect(refused.code).toBe('templatesForbidden')
    })

    it('inspects a page under its document id for a manager that may not read its title', async () => {
      const source = await pageWith()
      const body = { uid: GUIDE, documentId: source, locale: 'en', scope: 'site' }
      const response = await micelio(
        '/templates/inspect?site=default',
        { method: 'POST', json: body },
        'untitled@example.com'
      )
      const text = await response.text()
      expect(response.status, text).toBe(200)
      expect(text).not.toContain('Open source')
      const { data } = JSON.parse(text) as { data: { title: string; pageType: string } }
      // The page is a landing; a role that may not read pageType is told standard.
      expect(data).toMatchObject({ title: source, pageType: 'standard' })
      const full = (await (
        await micelio('/templates/inspect?site=default', { method: 'POST', json: body })
      ).json()) as { data: { title: string; pageType: string } }
      expect(full.data).toMatchObject({ title: 'Open source', pageType: 'landing' })
    })

    it('saves a template for a manager that may not read the title or type, without either', async () => {
      const source = await pageWith()
      const json = { uid: GUIDE, documentId: source, locale: 'en', name: 'Untitled', scope: 'site' }
      const response = await micelio(
        '/templates?site=default',
        { method: 'POST', json },
        'untitled@example.com'
      )
      expect(response.status).toBe(201)
      const { data } = (await response.json()) as { data: Summary & { pageTypes: string[] } }
      expect(data.pageTypes).toEqual(['standard'])
      const [stored] = (await strapi
        .documents(TEMPLATE)
        .findMany({ filters: { name: 'Untitled' } })) as unknown as {
        history: { cause: string; source?: string }[]
      }[]
      // The history names the page by what the manager may read: its document id, not its title.
      expect(stored.history).toEqual([expect.objectContaining({ cause: 'save', source })])
    })

    it('refuses to create a page from a template in a locale its role may not create', async () => {
      const template = await saved({ name: 'English only' })
      const title = 'Una página en español'
      const refused = await problem(
        await micelio(
          `/templates/${template.id}/pages`,
          { method: 'POST', json: { uid: GUIDE, site: 'default', locale: 'es', title } },
          'english@example.com'
        ),
        403
      )
      expect(refused.code).toBe('templatesForbidden')
      expect(await guides().findMany({ locale: 'es', filters: { title } } as never)).toHaveLength(0)
    })

    it('creates a page from a template in the locale its role may create', async () => {
      const template = await saved({ name: 'English allowed' })
      for (const locale of ['en', undefined]) {
        const response = await micelio(
          `/templates/${template.id}/pages`,
          { method: 'POST', json: { uid: GUIDE, site: 'default', locale, title: 'In English' } },
          'english@example.com'
        )
        const text = await response.text()
        expect(response.status, text).toBe(201)
        expect((JSON.parse(text) as { data: { locale: string } }).data.locale).toBe('en')
      }
    })

    it('starts no page with a block its site disabled after the template was saved', async () => {
      const template = await saved({ name: 'Disabled since' })
      const row = await strapi.documents(SETTING).create({
        data: { block: 'logo-cloud', enabled: false, site } as never,
      })
      try {
        const refused = await pageFrom(template.id, { title: 'Refused page' })
        expect(refused.status).toBe(400)
        expect(JSON.stringify(await refused.json())).toContain('blockNotAllowed')
        expect(await guides().findMany({ filters: { title: 'Refused page' } })).toHaveLength(0)
      } finally {
        await strapi.documents(SETTING).delete({ documentId: row.documentId })
      }
    })

    it('does not start a page on a site from the template of another', async () => {
      const template = await saved({ name: 'Only default' })
      const refused = await problem(await pageFrom(template.id, { site: 'other' }), 404)
      expect(refused.code).toBe('templateNotFound')
    })
  })

  describe('what the routes take', () => {
    it('gives each page made from a template a slug of its own', async () => {
      const template = await saved()
      const make = async () => {
        const response = await pageFrom(template.id, { title: 'A page of its own' })
        expect(response.status).toBe(201)
        return read(((await response.json()) as { data: { documentId: string } }).data.documentId)
      }
      expect((await make()).slug).toBe('a-page-of-its-own')
      expect((await make()).slug).toBe('a-page-of-its-own-2')
    })

    it('imports a template under the scope the request names', async () => {
      const original = await saved({ name: 'Scoped' })
      const { data } = (await (await micelio(`/templates/${original.id}/export`)).json()) as {
        data: Record<string, unknown>
      }
      await strapi.documents(TEMPLATE).delete({ documentId: original.id })
      const imported = await micelio('/templates/import?site=default&scope=cms', {
        method: 'POST',
        json: data,
      })
      expect(imported.status).toBe(201)
      expect(((await imported.json()) as { data: Summary }).data.scope).toBe('cms')
      const refused = await problem(
        await micelio('/templates/import?site=default&scope=world', { method: 'POST', json: data }),
        400
      )
      expect(refused).toMatchObject({ code: 'templateInvalid', field: 'scope' })
    })

    it('refuses a body that is malformed, or that makes a choice for a block the page lacks', async () => {
      const source = await pageWith()
      const noScope = await problem(
        await micelio('/templates?site=default', {
          method: 'POST',
          json: { uid: GUIDE, documentId: source, name: 'No scope' },
        }),
        400
      )
      expect(noScope).toMatchObject({ code: 'templateInvalid', field: 'body' })
      const wrongCount = await problem(
        await saveAs(source, { blocks: [{ content: 'sample', fixed: false }] }),
        400
      )
      expect(wrongCount).toMatchObject({ code: 'templateInvalid', field: 'blocks' })
      const noType = await problem(await micelio('/templates?site=default'), 400)
      expect(noType).toMatchObject({ code: 'templateInvalid', field: 'uid' })
      const noSite = await problem(await micelio(`/templates?site=nowhere&uid=${GUIDE}`), 404)
      expect(noSite.code).toBe('unknownSite')
    })

    it('lists the sites a page may be made on to a role that may create it', async () => {
      const listed = await micelio(`/templates/sites?uid=${GUIDE}`, {}, 'creator@example.com')
      expect(listed.status).toBe(200)
      expect(
        ((await listed.json()) as { data: { slug: string }[] }).data.map(({ slug }) => slug)
      ).toEqual(expect.arrayContaining(['default', 'other']))
      expect((await micelio(`/templates/sites?uid=${GUIDE}`, {}, 'plain@example.com')).status).toBe(
        403
      )
    })
  })

  describe('the type that stores the templates', () => {
    it('is hidden from the Content Manager, is site-scoped, is never exported and has no content API route', async () => {
      const schema = strapi.contentType(TEMPLATE as never) as {
        pluginOptions?: Record<string, unknown>
      }
      expect(schema.pluginOptions?.['content-manager']).toEqual({ visible: false })
      expect(schema.pluginOptions?.['content-type-builder']).toEqual({ visible: false })
      expect(schema.pluginOptions?.micelio).toMatchObject({ export: 'never', siteScoped: true })
      for (const path of ['/api/page-templates', '/api/micelio/page-templates']) {
        expect((await fetch(`${base}${path}`)).status).toBe(404)
      }
    })

    it('gives a page type the record of its template, and keeps the sample texts out of the content API', async () => {
      const attributes = strapi.contentType(GUIDE).attributes as Record<
        string,
        { type?: string; private?: boolean }
      >
      expect(attributes.templateId).toMatchObject({ type: 'string' })
      expect(attributes.templateVersion).toMatchObject({ type: 'integer' })
      expect(attributes.templateSamples).toMatchObject({ type: 'json', private: true })
    })
  })
})
