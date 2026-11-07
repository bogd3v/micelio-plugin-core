import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { BLOCKS, optionsOf } from '../../contract/blocks'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'

// `guide` is site-scoped, editorial and made with `withPageSettings` (test/strapi/app/src/api/guide/).
const GUIDE = 'api::guide.guide' as UID.ContentType
const TEMPLATE = 'plugin::micelio.page-template' as UID.ContentType
const PASSWORD = 'Password1234'
type Grant = string | { action: string; subject: string; properties: Record<string, unknown> }
const action = (grant: Grant) =>
  typeof grant === 'string'
    ? { action: grant, subject: null, properties: {}, conditions: [] }
    : { ...grant, conditions: [] }

interface Problem {
  code: string
  detail: string
  block?: string
  reason?: string
}

interface Block {
  block: string
  component: string
  content: 'sample' | 'clear'
  fixed: boolean
  data: Record<string, unknown>
}

interface Offer {
  isLinked: boolean
  template: { id: string; name: string; version: number; retired: boolean } | null
  version: number | null
  startedAt: string | null
  changes: { kind: string; block: string; option?: string; from?: string; to?: string }[]
  fixed: { block: string; nth: number }[]
}

type Section = Record<string, unknown> & { __component: string; id?: number }

// The Page templates page and the Template tab (#55): a template moves on in versions, a page offers
// what changed and never applies it by itself, and a fixed block stays until the page is detached.
describe('page template offers', () => {
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
      firstname: 'Pat',
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

  async function problem(response: Response, status: number): Promise<Problem> {
    expect(response.status).toBe(status)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    return (await response.json()) as Problem
  }

  async function data<T>(response: Response, status = 200): Promise<T> {
    expect(response.status).toBe(status)
    return ((await response.json()) as { data: T }).data
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

  /** A template saved from a page: the feature grid and the logos fixed, the text free. */
  async function template(fixed = [true, false, true]): Promise<string> {
    const response = await micelio('/templates?site=default', {
      method: 'POST',
      json: {
        uid: GUIDE,
        documentId: await pageWith(),
        locale: 'en',
        name: `Explainer ${Math.random().toString(36).slice(2, 8)}`,
        scope: 'site',
        pageTypes: ['landing'],
        blocks: fixed.map((isFixed) => ({ content: 'sample', fixed: isFixed })),
      },
    })
    return (await data<{ id: string }>(response, 201)).id
  }

  async function pageFrom(id: string): Promise<string> {
    const response = await micelio(`/templates/${id}/pages`, {
      method: 'POST',
      json: { uid: GUIDE, site: 'default', locale: 'en', title: 'My new page' },
    })
    return (await data<{ documentId: string }>(response, 201)).documentId
  }

  /** What the builder sends back: the stored defaults of the options a block does not expose go. */
  const clean = (zone: Section[]): Section[] =>
    zone.map((entry) => {
      const block = BLOCKS.find(({ schema }) => schema.component === entry.__component)
      const exposed = new Set(['variant', ...(block ? optionsOf(block).map(([name]) => name) : [])])
      return Object.fromEntries(
        Object.entries(entry).filter(
          ([name]) =>
            ![
              'variant',
              'columns',
              'density',
              'width',
              'tone',
              'align',
              'layout',
              'ratio',
            ].includes(name) || exposed.has(name)
        )
      ) as Section
    })

  async function read(documentId: string) {
    return (await guides().findOne({
      documentId,
      locale: 'en',
      populate: { sections: { populate: '*' } },
    } as never)) as unknown as Record<string, unknown> & { sections: Section[] }
  }

  const target = (documentId: string) => ({ uid: GUIDE, documentId, locale: 'en' })
  const offerOf = async (documentId: string, who = root) =>
    data<Offer>(
      await micelio(`/templates/offer?uid=${GUIDE}&documentId=${documentId}&locale=en`, {}, who)
    )

  /** Saves the next version of a template: `change` edits its blocks. */
  async function bump(id: string, change: (blocks: Block[]) => Block[]): Promise<void> {
    const detail = await data<{ version: number; blocks: Block[] }>(
      await micelio(`/templates/${id}`)
    )
    const response = await micelio(`/templates/${id}`, {
      method: 'PUT',
      json: { expectedVersion: detail.version, blocks: change(detail.blocks) },
    })
    expect(response.status).toBe(200)
  }

  const feature = (blocks: Block[]) => blocks[0]

  beforeAll(async () => {
    strapi = await setupStrapi()
    base = `http://127.0.0.1:${(strapi.server.httpServer.address() as AddressInfo).port}`
    const siteService = strapi.documents(SITE_UID as UID.ContentType)
    site = (await siteService.findFirst({ filters: { slug: 'default' } }))!.documentId
    await siteService.create({ data: { name: 'Other', slug: 'other', modules: {} } as never })
    // A second locale, made before any request: creating one resets the connections already open.
    await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' })
    await createUser(root, 'super')
    const fields = ['title', 'slug', 'sections', 'pageType']
    // The type is localised: a grant names the locales it covers.
    const locales = ['en']
    const read = {
      action: 'plugin::content-manager.explorer.read',
      subject: GUIDE,
      properties: { locales },
    }
    const update = {
      action: 'plugin::content-manager.explorer.update',
      subject: GUIDE,
      properties: { fields, locales },
    }
    await createUser('manager@example.com', ['plugin::micelio.templates.manage', read, update])
    await createUser('editor@example.com', [read, update])
    await createUser('reader@example.com', [read])
    await createUser('plain@example.com', [])
    await createUser('blind@example.com', ['plugin::micelio.templates.manage'])
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('the offer adds exactly the new block and leaves edited options alone', async () => {
    const id = await template([false, false, false])
    const documentId = await pageFrom(id)
    const before = await read(documentId)
    // The editor changed the columns of the feature grid on the page, and nothing else.
    await guides().update({
      documentId,
      locale: 'en',
      data: {
        sections: clean(before.sections.map((s, i) => (i === 0 ? { ...s, columns: '3' } : s))),
      } as never,
    })
    const idsBefore = (await read(documentId)).sections.map(({ id: kept }) => kept)

    // The template moves on: the grid's columns and density change, and a second text arrives
    // after the first.
    await bump(id, (blocks) => [
      {
        ...feature(blocks),
        data: { ...feature(blocks).data, columns: '2', density: 'comfortable' },
      },
      blocks[1],
      { ...blocks[1], data: { body: 'A new text.', width: 'wide' } },
      blocks[2],
    ])

    // Nothing is applied by itself: the page still holds version 1 and what it had.
    const offer = await offerOf(documentId)
    expect(offer).toMatchObject({ isLinked: true, version: 1, template: { version: 2 } })
    expect(offer.changes).toEqual([
      { kind: 'option', block: 'feature-grid', option: 'columns', from: '4', to: '2' },
      {
        kind: 'option',
        block: 'feature-grid',
        option: 'density',
        from: 'compact',
        to: 'comfortable',
      },
      { kind: 'added', block: 'rich-text', after: 'rich-text' },
    ])
    expect((await read(documentId)).sections).toHaveLength(3)
    expect((await read(documentId)).templateVersion).toBe(1)

    const applied = await data<Offer>(
      await micelio('/templates/apply', { method: 'POST', json: target(documentId) })
    )
    expect(applied.changes).toEqual([])
    expect(applied.version).toBe(2)

    const page = await read(documentId)
    // Exactly one block more, after the text, holding the template's sample text.
    expect(page.sections.map(({ __component }) => __component)).toEqual([
      'section.feature-grid',
      'section.rich-text',
      'section.rich-text',
      'section.logo-cloud',
    ])
    expect(page.sections[2]).toMatchObject({ body: 'A new text.' })
    // The option the editor changed stays; the one the page kept at the template's value moves.
    expect(page.sections[0]).toMatchObject({ columns: '3', density: 'comfortable' })
    // The blocks the page had keep their rows and their content.
    expect([page.sections[0].id, page.sections[1].id, page.sections[3].id]).toEqual([
      idsBefore[0],
      idsBefore[1],
      idsBefore[2],
    ])
    expect(page.sections[0]).toMatchObject({ title: 'Why Micelio' })
    expect(page.templateVersion).toBe(2)
    // The new block's sample text keeps the page from being published until it is replaced.
    expect(page.templateSamples).toContain('A new text.')
  })

  it('detach lifts the fixed marks', async () => {
    const id = await template()
    const documentId = await pageFrom(id)
    expect((await offerOf(documentId)).fixed).toEqual([
      { block: 'feature-grid', nth: 1 },
      { block: 'logo-cloud', nth: 1 },
    ])
    const fixedPage = await read(documentId)
    const without = fixedPage.sections.filter((s) => s.__component !== 'section.feature-grid')

    // While the mark holds, the block cannot go.
    await expect(
      guides().update({ documentId, locale: 'en', data: { sections: clean(without) } as never })
    ).rejects.toMatchObject({ details: { code: 'templateBlockFixed', block: 'feature-grid' } })

    const detached = await data<Offer>(
      await micelio('/templates/detach', { method: 'POST', json: target(documentId) })
    )
    expect(detached).toMatchObject({ isLinked: false, template: null, fixed: [] })
    const page = await read(documentId)
    expect(page).toMatchObject({ templateId: null, templateVersion: null, templateFixed: [] })
    // The page keeps its blocks and its sample text; only the lock and the offers are gone.
    expect(page.sections).toHaveLength(3)
    expect(page.templateSamples).not.toEqual([])
    await guides().update({ documentId, locale: 'en', data: { sections: clean(without) } as never })
    expect((await read(documentId)).sections).toHaveLength(2)
  })

  it('refuses to remove or reorder a fixed block, in the Content Manager too', async () => {
    const id = await template([true, false, true])
    const documentId = await pageFrom(id)
    const { sections: held } = await read(documentId)
    const path = `/content-manager/collection-types/${GUIDE}/${documentId}?locale=en`
    const save = (zone: Section[], who = root) =>
      asAdmin(who, path, { method: 'PUT', json: { sections: zone } })

    const removed = await save(clean(held.filter((s) => s.__component !== 'section.logo-cloud')))
    expect(removed.status).toBe(400)
    expect(JSON.stringify(await removed.json())).toContain('templateBlockFixed')
    // The two fixed blocks swapping places is a move; a free block moving is not.
    await expect(
      guides().update({
        documentId,
        locale: 'en',
        data: { sections: clean([held[2], held[1], held[0]]) } as never,
      })
    ).rejects.toMatchObject({ details: { code: 'templateBlockFixed', reason: 'moved' } })
    await guides().update({
      documentId,
      locale: 'en',
      data: { sections: clean([held[0], held[2], held[1]]) } as never,
    })
    // A new block of the same type before the fixed one does not take its place: the original is
    // still the fixed one, so removing it after that is refused as well.
    const grid = held[0]
    await guides().update({
      documentId,
      locale: 'en',
      data: {
        sections: clean([{ __component: 'section.feature-grid', title: 'Another' }, ...held]),
      } as never,
    })
    const afterInsert = (await read(documentId)).sections
    expect(afterInsert).toHaveLength(4)
    // The mark moved with its block: the original grid is now the second one.
    expect(
      ((await guides().findOne({ documentId, locale: 'en' })) as never as Record<string, unknown>)
        .templateFixed
    ).toEqual([
      { block: 'feature-grid', nth: 2 },
      { block: 'logo-cloud', nth: 1 },
    ])
    const withoutOriginal = afterInsert.filter(
      (s) => !(s.__component === grid.__component && s.id === grid.id)
    )
    expect(withoutOriginal).toHaveLength(3)
    expect(JSON.stringify(await (await save(clean(withoutOriginal))).json())).toContain(
      'templateBlockFixed'
    )
    // Deleting the fixed block and putting an empty one of its type in its place is a removal.
    const swapped = clean(
      afterInsert.map((s) =>
        s.__component === grid.__component && s.id === grid.id
          ? { __component: 'section.feature-grid', title: 'Impostor' }
          : s
      )
    )
    expect((await save(swapped)).status).toBe(400)
    // Naming templateFixed in the data lifts nothing: the lock is not a key a client can send.
    const unlock = await asAdmin(root, path, {
      method: 'PUT',
      json: { sections: clean(withoutOriginal), templateFixed: [] },
    })
    expect(unlock.status).toBe(400)
    expect(JSON.stringify(await unlock.json())).toContain('templateBlockFixed')
    // An edit that leaves the fixed blocks alone saves.
    expect((await save(clean((await read(documentId)).sections))).status).toBe(200)
    // A page no template made, and one that names no zone, are not checked.
    await guides().update({ documentId, locale: 'en', data: { title: 'Renamed' } as never })
  })

  it('does not let the content API lift a lock by naming templateFixed', async () => {
    const documentId = await pageFrom(await template([true, false, true]))
    const { sections: held } = await read(documentId)
    const token = (
      (await strapi.service('admin::api-token').create({
        name: 'fixed-blocks',
        type: 'full-access',
        lifespan: null,
      })) as { accessKey: string }
    ).accessKey
    const put = (body: Record<string, unknown>) =>
      fetch(`${base}/api/guides/${documentId}?locale=en&status=draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ data: body }),
      })
    // The content API takes no row ids, so any zone it sends drops the fixed blocks.
    expect(held).toHaveLength(3)
    const without = [{ __component: 'section.rich-text', body: 'Only this.' }]
    const response = await put({ sections: without, templateFixed: [] })
    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('Invalid key templateFixed')
    // Without the key the removal is refused by the lock itself.
    const plain = await put({ sections: without })
    expect(plain.status).toBe(400)
    expect(JSON.stringify(await plain.json())).toContain('templateBlockFixed')
    const stored = (await guides().findOne({ documentId, locale: 'en' })) as never as {
      templateFixed: unknown[]
    }
    expect(stored.templateFixed).toHaveLength(2)
    expect((await read(documentId)).sections).toHaveLength(3)
  })

  it('keeps the marks of each locale: an edit of one locale does not move the others', async () => {
    const id = await template([true, false, true])
    const documentId = await pageFrom(id)
    const { sections: held } = await read(documentId)
    const grid = held[0]
    // A Spanish version of the same page, made in the Content Manager as an editor makes it.
    const spanishPath = `/content-manager/collection-types/${GUIDE}/${documentId}?locale=es`
    const made = await asAdmin(root, spanishPath, {
      method: 'PUT',
      json: { title: 'Código abierto', sections: clean(held.map(({ id: _, ...rest }) => rest)) },
    })
    expect(made.status).toBe(200)
    const spanish = (await guides().findOne({
      documentId,
      locale: 'es',
      populate: { sections: { populate: '*' } },
    } as never)) as never as { sections: Section[] }
    // A write of the plugin that names the marks (here, starting again from the same template)
    // is where a shared attribute would reach the Spanish page.
    await data(
      await micelio('/templates/switch', {
        method: 'POST',
        json: { ...target(documentId), to: id, dryRun: false },
      })
    )
    // Putting a feature grid before the first one in Spanish moves nothing in English.
    const edited = await asAdmin(root, spanishPath, {
      method: 'PUT',
      json: {
        sections: clean([
          { __component: 'section.feature-grid', title: 'Otro' },
          ...spanish.sections,
        ]),
      },
    })
    expect(edited.status).toBe(200)
    const english = (await guides().findOne({ documentId, locale: 'en' })) as never as {
      templateFixed: unknown[]
    }
    expect(english.templateFixed).toEqual([
      { block: 'feature-grid', nth: 1 },
      { block: 'logo-cloud', nth: 1 },
    ])
    // So the English fixed grid is still locked.
    const without = (await read(documentId)).sections.filter(
      (s) => !(s.__component === grid.__component && s.id === grid.id)
    )
    await expect(
      guides().update({ documentId, locale: 'en', data: { sections: clean(without) } as never })
    ).rejects.toMatchObject({ details: { code: 'templateBlockFixed', block: 'feature-grid' } })
    // Detaching acts on the locale it names. The Spanish page is linked and marked (as a switch
    // there would leave it), and a manager who may update English only detaches English.
    const marks = [{ block: 'feature-grid', nth: 1 }]
    await strapi.db.query(GUIDE).update({
      where: { documentId, locale: 'es', publishedAt: null },
      data: { templateId: id, templateVersion: 1, templateFixed: marks },
    })
    const detached = await data<Offer>(
      await micelio(
        '/templates/detach',
        { method: 'POST', json: target(documentId) },
        'manager@example.com'
      )
    )
    expect(detached).toMatchObject({ isLinked: false, fixed: [] })
    const kept = (await guides().findOne({ documentId, locale: 'es' })) as never as {
      templateFixed: unknown[]
      templateId: string
    }
    expect(kept.templateFixed).toEqual(marks)
    expect(kept.templateId).toBe(id)
    const spanishOffer = await data<Offer>(
      await micelio(`/templates/offer?uid=${GUIDE}&documentId=${documentId}&locale=es`, {}, root)
    )
    expect(spanishOffer.isLinked).toBe(true)
  })

  it('switching lists what would be dropped and does it only when told', async () => {
    const first = await template([false, false, false])
    const second = (
      await data<{ id: string }>(
        await micelio('/templates?site=default', {
          method: 'POST',
          json: {
            uid: GUIDE,
            documentId: await pageWith([
              { __component: 'section.rich-text', body: 'Another start.' },
              { __component: 'section.scene', title: 'Scene', variant: 'background' },
            ]),
            locale: 'en',
            name: `Second ${Math.random().toString(36).slice(2, 8)}`,
            scope: 'site',
          },
        }),
        201
      )
    ).id
    const documentId = await pageFrom(first)
    const body = (dryRun: boolean) => ({ ...target(documentId), to: second, dryRun })

    const looked = await data<{
      plan: { keeps: string[]; adds: string[]; drops: { block: string }[] }
    }>(await micelio('/templates/switch', { method: 'POST', json: body(true) }))
    expect(looked.plan.keeps).toEqual(['rich-text'])
    expect(looked.plan.adds).toEqual(['scene'])
    expect(looked.plan.drops.map(({ block }) => block)).toEqual(['feature-grid', 'logo-cloud'])
    // A look changes nothing.
    expect((await read(documentId)).templateId).toBe(first)
    expect((await read(documentId)).sections).toHaveLength(3)

    const done = await data<{ offer: Offer }>(
      await micelio('/templates/switch', { method: 'POST', json: body(false) })
    )
    expect(done.offer).toMatchObject({ version: 1, template: { id: second } })
    const page = await read(documentId)
    expect(page.sections.map(({ __component }) => __component)).toEqual([
      'section.rich-text',
      'section.scene',
    ])
    // The text the page kept is the page's own, not the template's.
    expect(page.sections[0]).toMatchObject({ body: 'Open source, in plain words.' })
    expect(page.templateId).toBe(second)
  })

  it('lists the pages made from each template, and counts only those still linked', async () => {
    const id = await template()
    const other = await template()
    const pages = [await pageFrom(id), await pageFrom(id), await pageFrom(id)]
    await pageFrom(other)
    const published = (
      await micelio('/transitions', {
        method: 'POST',
        json: { uid: GUIDE, documentId: pages[0], locale: 'en', to: 'review' },
      })
    ).status
    expect(published).toBeLessThan(500)

    const list = await data<
      {
        id: string
        usage: { count: number; pages: { documentId: string; version: number; state: string }[] }
      }[]
    >(await micelio('/templates/manage?site=default'))
    expect(list.find((entry) => entry.id === id)?.usage.count).toBe(3)
    expect(list.find((entry) => entry.id === other)?.usage.count).toBe(1)
    expect(
      list
        .find((entry) => entry.id === id)
        ?.usage.pages.map(({ documentId }) => documentId)
        .sort()
    ).toEqual([...pages].sort())

    await micelio('/templates/detach', { method: 'POST', json: target(pages[1]) })
    const again = await data<typeof list>(await micelio('/templates/manage?site=default'))
    expect(again.find((entry) => entry.id === id)?.usage.count).toBe(2)

    // A manager who may not read the page type sees the templates and none of its pages.
    const blind = await data<typeof list>(
      await micelio('/templates/manage?site=default', {}, 'blind@example.com')
    )
    expect(blind.find((entry) => entry.id === id)).toMatchObject({
      usage: { count: 0, pages: [] },
    })
    // A manager who may read it sees them.
    const seen = await data<typeof list>(
      await micelio('/templates/manage?site=default', {}, 'manager@example.com')
    )
    expect(seen.find((entry) => entry.id === id)?.usage.count).toBe(2)
  })

  it('saves a version with what changed, refuses a stale one and writes nothing for no change', async () => {
    const id = await template([false, false, false])
    const detail = await data<{ version: number; blocks: Block[] }>(
      await micelio(`/templates/${id}`)
    )
    expect(detail.version).toBe(1)

    const same = await micelio(`/templates/${id}`, {
      method: 'PUT',
      json: { expectedVersion: 1, blocks: detail.blocks },
    })
    expect((await data<{ version: number }>(same)).version).toBe(1)

    const fixedLogos = detail.blocks.map((block) =>
      block.block === 'logo-cloud' ? { ...block, fixed: true } : block
    )
    const saved = await micelio(`/templates/${id}`, {
      method: 'PUT',
      json: { expectedVersion: 1, blocks: fixedLogos },
    })
    expect((await data<{ version: number }>(saved)).version).toBe(2)
    const stale = await micelio(`/templates/${id}`, {
      method: 'PUT',
      json: { expectedVersion: 1, blocks: detail.blocks },
    })
    expect((await problem(stale, 409)).code).toBe('templateVersionConflict')

    const [managed] = (
      await data<
        {
          id: string
          history: { version: number; by: string; cause: string; changes: unknown[] }[]
        }[]
      >(await micelio('/templates/manage?site=default'))
    ).filter((entry) => entry.id === id)
    expect(managed.history.map(({ version, cause }) => [version, cause])).toEqual([
      [2, 'edit'],
      [1, 'save'],
    ])
    expect(managed.history[0].changes).toEqual([{ kind: 'fixed', block: 'logo-cloud' }])
    expect(managed.history[0].by).toBe('Pat root')
    expect(JSON.stringify(managed.history)).not.toContain('"blocks"')

    // An option the catalogue does not offer is refused.
    const bad = detail.blocks.map((block, index) =>
      index === 0 ? { ...block, data: { ...block.data, columns: '9' } } : block
    )
    const refused = await micelio(`/templates/${id}`, {
      method: 'PUT',
      json: { expectedVersion: 2, blocks: bad },
    })
    expect((await problem(refused, 400)).code).toBe('blockOptionInvalid')
  })

  it('retires a template, which leaves the gallery and starts no page, and duplicates one', async () => {
    const id = await template()
    const documentId = await pageFrom(id)
    const retired = await data<{ retired: boolean }>(
      await micelio(`/templates/${id}/retire`, { method: 'POST', json: { retired: true } })
    )
    expect(retired.retired).toBe(true)

    const listed = await data<{ id: string }[]>(
      await micelio(`/templates?site=default&uid=${GUIDE}`)
    )
    expect(listed.map((entry) => entry.id)).not.toContain(id)
    const managed = await data<{ id: string; retired: boolean }[]>(
      await micelio('/templates/manage?site=default')
    )
    expect(managed.find((entry) => entry.id === id)?.retired).toBe(true)
    const refused = await micelio(`/templates/${id}/pages`, {
      method: 'POST',
      json: { uid: GUIDE, site: 'default', locale: 'en' },
    })
    expect((await problem(refused, 409)).code).toBe('templateRetired')
    // The page made before is untouched.
    expect((await read(documentId)).templateId).toBe(id)

    const copy = await data<{ id: string; name: string; version: number; retired: boolean }>(
      await micelio(`/templates/${id}/duplicate?site=other`, { method: 'POST' }),
      201
    )
    expect(copy).toMatchObject({ version: 1, retired: false })
    expect(copy.name).toMatch(/\(copy\)$/)
    expect(copy.id).not.toBe(id)
    const twice = await data<{ name: string }>(
      await micelio(`/templates/${id}/duplicate?site=other`, { method: 'POST' }),
      201
    )
    expect(twice.name).not.toBe(copy.name)
  })

  it('keeps a template of a theme read-only', async () => {
    const id = await template()
    await strapi.db.query(TEMPLATE).update({ where: { documentId: id }, data: { origin: 'theme' } })
    const detail = await data<{ version: number; blocks: Block[] }>(
      await micelio(`/templates/${id}`)
    )
    const edit = await micelio(`/templates/${id}`, {
      method: 'PUT',
      json: { expectedVersion: 1, blocks: detail.blocks.slice(1) },
    })
    expect((await problem(edit, 409)).code).toBe('templateReadOnly')
    const retire = await micelio(`/templates/${id}/retire`, {
      method: 'POST',
      json: { retired: true },
    })
    expect((await problem(retire, 409)).code).toBe('templateReadOnly')
    // A copy is the way to change it.
    expect(
      (await micelio(`/templates/${id}/duplicate?site=default`, { method: 'POST' })).status
    ).toBe(201)
  })

  it('gives each action to the role that may do it and to no other', async () => {
    const id = await template([true, false, false])
    const documentId = await pageFrom(id)
    await bump(id, (blocks) => [blocks[0], blocks[1], { ...blocks[2], fixed: true }])
    const manager = 'manager@example.com'
    const editor = 'editor@example.com'
    const reader = 'reader@example.com'

    // Managing needs templates.manage.
    for (const path of ['/templates/manage?site=default', `/templates/${id}`]) {
      expect((await problem(await micelio(path, {}, editor), 403)).code).toBe('templatesForbidden')
    }
    expect(
      (
        await micelio(
          `/templates/${id}`,
          { method: 'PUT', json: { expectedVersion: 2, blocks: [] } },
          editor
        )
      ).status
    ).toBe(403)
    expect(
      (
        await micelio(
          `/templates/${id}/retire`,
          { method: 'POST', json: { retired: true } },
          editor
        )
      ).status
    ).toBe(403)
    // Detaching is the manager's: an editor may not lift a lock.
    expect(
      (await micelio('/templates/detach', { method: 'POST', json: target(documentId) }, editor))
        .status
    ).toBe(403)

    // Reading the offer needs the page; applying it needs to write the blocks.
    const asReader = await micelio(
      `/templates/offer?uid=${GUIDE}&documentId=${documentId}&locale=en`,
      {},
      reader
    )
    expect((await data<Offer>(asReader)).template?.version).toBe(2)
    expect(
      (
        await problem(
          await micelio(
            `/templates/offer?uid=${GUIDE}&documentId=${documentId}&locale=en`,
            {},
            'plain@example.com'
          ),
          403
        )
      ).code
    ).toBe('templatesForbidden')
    expect(
      (await micelio('/templates/apply', { method: 'POST', json: target(documentId) }, reader))
        .status
    ).toBe(403)
    expect(
      (await micelio('/templates/apply', { method: 'POST', json: target(documentId) }, editor))
        .status
    ).toBe(200)
    expect(
      (await micelio('/templates/detach', { method: 'POST', json: target(documentId) }, manager))
        .status
    ).toBe(200)
  })

  it('is stored with a history, hidden from the content API and refuses a malformed body', async () => {
    const id = await template()
    const row = (await strapi.db.query(TEMPLATE).findOne({ where: { documentId: id } })) as {
      history: { version: number; cause: string; source: string }[]
      retired: boolean
    }
    expect(row.history).toMatchObject([{ version: 1, cause: 'save', source: 'Open source' }])
    expect(row.retired).toBe(false)
    expect(
      (await problem(await micelio('/templates/apply', { method: 'POST', json: {} }), 400)).code
    ).toBe('templateInvalid')
    expect(
      (await problem(await micelio(`/templates/${id}/retire`, { method: 'POST', json: {} }), 400))
        .code
    ).toBe('templateInvalid')
    expect(
      (await problem(await micelio(`/templates/${id}`, { method: 'PUT', json: {} }), 400)).code
    ).toBe('templateInvalid')
    expect((await micelio('/templates/missing')).status).toBe(404)
  })
})
