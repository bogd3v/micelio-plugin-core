import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import { REUSABLE_BLOCK_UID } from '../../server/src/constants/reusable-blocks'
import { SITE_UID } from '../../server/src/constants/site'
import type { Actor } from '../../server/src/editorial/machine'
import type { ReusableBlocksService } from '../../server/src/services/reusable-blocks'
import type { TransitionsService } from '../../server/src/services/transitions'
import type { EntryPayload, HookName, MicelioHooks } from '../../server/src/types/hooks'
import { cleanupStrapi, setupStrapi } from './harness'

// The page fixture (test/strapi/app/src/api/page/) references reusable blocks through its
// `section.reusable` component, the shape #201 gives it in micelio-cms.
const PAGE = 'api::page.page' as UID.ContentType
const REUSABLE = REUSABLE_BLOCK_UID as UID.ContentType

const cta = (title: string) => ({ __component: 'section.cta', title })
const reference = (documentId: string) => ({
  __component: 'section.reusable',
  reusableBlock: documentId,
})

describe('the reusable blocks', () => {
  let strapi: Core.Strapi
  let site: string
  let other: string
  let admin: Actor

  const reusable = () => strapi.documents(REUSABLE)
  const pages = () => strapi.documents(PAGE)
  const service = () => strapi.plugin('micelio').service('reusableBlocks') as ReusableBlocksService
  const transitions = () => strapi.plugin('micelio').service('transitions') as TransitionsService
  const hooks = () => (strapi.plugin('micelio') as unknown as { hooks: MicelioHooks }).hooks

  async function createReusable(name: string, inSite = site, blocks = [cta(name)]) {
    const created = await reusable().create({
      locale: 'en',
      data: { name, blocks, site: inSite } as never,
    })
    return created.documentId
  }

  async function createPage(slug: string, sections: unknown[], locale = 'en', documentId?: string) {
    const data = { title: slug, slug, sections } as never
    if (documentId) {
      await pages().update({ documentId, locale, data })
      return documentId
    }
    const created = await pages().create({ locale, data: { ...(data as object), site } as never })
    return created.documentId
  }

  async function publish(documentId: string) {
    for (const to of ['in_review', 'published'] as const) {
      await transitions().perform({ uid: REUSABLE, documentId, locale: 'en', to, actor: admin })
    }
  }

  // Every row of the pages, as the database holds them: what a republish must leave alone.
  const pageRows = () =>
    strapi.db.query(PAGE).findMany({
      select: ['id', 'documentId', 'locale', 'updatedAt', 'publishedAt'],
      orderBy: { id: 'asc' },
    })

  // The `details` of the error a write is refused with; `undefined` when it is not refused.
  const codeOf = async (work: Promise<unknown>) => {
    try {
      await work
      return undefined
    } catch (error) {
      return (error as { details?: { code?: string; pages?: unknown } }).details
    }
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    site = (await sites.findFirst({}))!.documentId
    other = (await sites.create({ data: { name: 'Other', slug: 'other', modules: {} } as never }))
      .documentId
    await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' })
    const role = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    const user = (await strapi.service('admin::user').create({
      email: 'reuser@example.com',
      firstname: 'Re',
      lastname: 'User',
      roles: [role.id],
      isActive: true,
    })) as { id: number }
    admin = { kind: 'user', id: user.id, roles: ['strapi-super-admin'] }
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('is a site-scoped, editorial type shown in the Content Manager, whose zone holds the page blocks of the host', () => {
    const type = strapi.contentType(REUSABLE)
    expect(type.pluginOptions).toMatchObject({
      'content-manager': { visible: true },
      micelio: { siteScoped: true, editorial: true },
    })
    const zone = type.attributes.blocks as { components: string[]; min: number; max: number }
    expect(zone).toMatchObject({ type: 'dynamiczone', min: 1, max: 1 })
    expect(zone.components).toContain('section.cta')
    expect(zone.components).not.toContain('section.reusable')
    expect(zone.components).not.toContain('shared.quote')
    expect(service().referenceFields()).toEqual([
      { uid: PAGE, zone: 'sections', component: 'section.reusable', attribute: 'reusableBlock' },
    ])
  })

  it('a reusable block holds exactly one block, never a reusable, and no group key', async () => {
    const target = await createReusable('Target')
    expect(await codeOf(createReusable('Two', site, [cta('One'), cta('Two')]))).toMatchObject({
      code: 'reusableBlockInvalid',
      reason: 'count',
      count: 2,
    })
    expect(
      await codeOf(createReusable('Nested', site, [reference(target) as never]))
    ).toMatchObject({ code: 'reusableBlockInvalid', reason: 'reference' })
    const grouped = { ...cta('Grouped'), group: { groupId: 'band', tone: 'raised' } }
    expect(await codeOf(createReusable('Grouped', site, [grouped]))).toMatchObject({
      code: 'reusableBlockInvalid',
      reason: 'group',
    })
    expect(
      await codeOf(
        reusable().update({
          documentId: target,
          locale: 'en',
          data: { blocks: [cta('One'), cta('Two')] } as never,
        })
      )
    ).toMatchObject({ code: 'reusableBlockInvalid', reason: 'count' })

    // A draft may have no block yet; it cannot be published so.
    const empty = await createReusable('Empty', site, [])
    await transitions().perform({
      uid: REUSABLE,
      documentId: empty,
      locale: 'en',
      to: 'in_review',
      actor: admin,
    })
    await expect(
      transitions().perform({
        uid: REUSABLE,
        documentId: empty,
        locale: 'en',
        to: 'published',
        actor: admin,
      })
    ).rejects.toThrow()
    expect(await reusable().findOne({ documentId: empty, status: 'published' } as never)).toBeNull()
  })

  it("refuses a reference to another site's reusable block", async () => {
    const own = await createReusable('Own')
    const foreign = await createReusable('Foreign', other)
    expect(await codeOf(createPage('foreign', [reference(foreign)]))).toMatchObject({
      code: 'reusableBlockOtherSite',
      documentId: foreign,
    })
    const page = await createPage('own', [reference(own)])
    const connect = { __component: 'section.reusable', reusableBlock: { connect: [foreign] } }
    expect(
      await codeOf(
        pages().update({ documentId: page, locale: 'en', data: { sections: [connect] } as never })
      )
    ).toMatchObject({ code: 'reusableBlockOtherSite' })
    // A move to another site that leaves the zone alone keeps the reference to this site's block.
    expect(
      await codeOf(
        pages().update({ documentId: page, locale: 'en', data: { site: other } as never })
      )
    ).toMatchObject({ code: 'reusableBlockOtherSite', documentId: own })
    const moved = await createPage('moved', [{ __component: 'shared.rich-text', body: 'Text' }])
    await pages().update({ documentId: moved, locale: 'en', data: { site: other } as never })
  })

  it("never resolves a reference to another site's reusable block in the content API", async () => {
    const moving = await createReusable('Moving')
    await createPage('moving', [reference(moving)])
    // An entry of one locale may change site (#45); its page stays where it was.
    await reusable().update({ documentId: moving, locale: 'en', data: { site: other } as never })

    const { port } = strapi.server.httpServer.address() as AddressInfo
    const token = (await strapi.service('admin::api-token').create({
      name: 'reusable-suite',
      type: 'full-access',
      lifespan: null,
    })) as { accessKey: string }
    const read = async (path: string) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { Authorization: `Bearer ${token.accessKey}` },
      })
      return (await response.json()) as { data: Record<string, unknown>[] }
    }
    const populate = 'populate[sections][on][section.reusable][populate]=reusableBlock'
    const { data } = await read(`/api/pages?status=draft&filters[slug]=moving&${populate}`)
    expect(data[0]?.sections).toEqual([
      expect.objectContaining({ __component: 'section.reusable', reusableBlock: null }),
    ])
    const own = await read(`/api/reusable-blocks?status=draft&filters[name]=Moving`)
    expect(own.data).toEqual([])
    const there = await read(`/api/reusable-blocks?site=other&status=draft&filters[name]=Moving`)
    expect(there.data).toHaveLength(1)
  })

  it('refuses to delete a referenced reusable block and lists the pages', async () => {
    const used = await createReusable('Used')
    await reusable().update({
      documentId: used,
      locale: 'es',
      data: { name: 'Usado', blocks: [cta('Usado')] } as never,
    })
    const page = await createPage('uses', [reference(used)])
    await createPage('usa', [reference(used)], 'es', page)

    const details = await codeOf(reusable().delete({ documentId: used, locale: '*' } as never))
    expect(details).toMatchObject({ code: 'reusableBlockInUse' })
    expect(details?.pages).toEqual([
      { uid: PAGE, documentId: page, locale: 'es', title: 'usa', published: false },
      { uid: PAGE, documentId: page, locale: 'en', title: 'uses', published: false },
    ])
    expect(await reusable().findOne({ documentId: used, locale: 'en' } as never)).not.toBeNull()

    const unused = await createReusable('Unused')
    await reusable().delete({ documentId: unused, locale: '*' } as never)
    expect(await reusable().findOne({ documentId: unused, locale: 'en' } as never)).toBeNull()
  })

  describe('republishing', () => {
    let block: string
    let page: string

    beforeAll(async () => {
      block = await createReusable('Announcement')
      page = await createPage('announced', [reference(block)])
      await pages().publish({ documentId: page, locale: 'en' } as never)
      await createPage('elsewhere', [cta('Not a reference')])
    })

    it('publishing it lists the referencing pages without editing them or firing their hooks', async () => {
      const republish = vi.spyOn(service(), 'republish')
      const fired: { hook: HookName; payload: EntryPayload }[] = []
      const off = ['afterPublish', 'afterUnpublish', 'afterTransition'].map((hook) =>
        hooks().on(hook as 'afterPublish', (payload) => {
          fired.push({ hook: hook as HookName, payload: { ...payload } })
        })
      )
      const before = await pageRows()
      try {
        await publish(block)
        // Republish, then unpublish: each lists the pages the same way.
        await transitions().perform({
          uid: REUSABLE,
          documentId: block,
          locale: 'en',
          to: 'published',
          actor: admin,
        })
        await transitions().perform({
          uid: REUSABLE,
          documentId: block,
          locale: 'en',
          to: 'draft',
          actor: admin,
        })
      } finally {
        off.forEach((remove) => remove())
      }
      const calls = republish.mock.calls.map(([payload]) => payload.documentId)
      const results = await Promise.all(republish.mock.results.map((result) => result.value))
      republish.mockRestore()

      const listed = [
        { uid: PAGE, documentId: page, locale: 'en', title: 'announced', published: true },
      ]
      expect(calls).toEqual([block, block, block])
      expect(results).toEqual([listed, listed, listed])
      expect(await pageRows()).toEqual(before)
      expect(new Set(fired.map(({ payload }) => payload.type))).toEqual(new Set([REUSABLE]))
      expect(
        fired.filter(({ hook }) => hook !== 'afterTransition').map(({ hook }) => hook)
      ).toEqual(['afterPublish', 'afterPublish', 'afterUnpublish'])
    })

    it('a second run of the republish handler for the same documentId and locale changes nothing', async () => {
      await publish(block)
      const payload: EntryPayload = {
        site,
        type: REUSABLE_BLOCK_UID,
        documentId: block,
        locale: 'en',
        actor: { kind: 'system' },
      }
      const fired: string[] = []
      const off = hooks().on('afterPublish', (published) => {
        fired.push(published.documentId)
      })
      const before = await pageRows()
      const blockRows = () =>
        strapi.db.query(REUSABLE).findMany({ where: { documentId: block }, orderBy: { id: 'asc' } })
      const blockBefore = await blockRows()
      try {
        const first = await service().republish(payload)
        const second = await service().republish(payload)
        expect(second).toEqual(first)
        expect(first.map((listed) => listed.documentId)).toEqual([page])
      } finally {
        off()
      }
      expect(await pageRows()).toEqual(before)
      expect(await blockRows()).toEqual(blockBefore)
      expect(fired).toEqual([])
    })
  })
})
