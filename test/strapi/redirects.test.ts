import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { REDIRECT_UID } from '../../server/src/constants/page-settings'
import { SITE_UID } from '../../server/src/constants/site'
import { TransitionError } from '../../server/src/editorial/transitions'
import type { TransitionsService } from '../../server/src/services/transitions'
import { cleanupStrapi, setupStrapi } from './harness'

// `guide` is site-scoped, editorial and made with `withPageSettings`, and the budgets do not list it:
// publishing it needs no frontend (test/strapi/app/src/api/guide/).
const GUIDE = 'api::guide.guide' as UID.ContentType
const REDIRECTS = REDIRECT_UID as UID.ContentType
// Editorial with a slug, but not made with `withPageSettings` (test/strapi/app/src/api/memo/).
const MEMO = 'api::memo.memo' as UID.ContentType

describe('the redirects of a page whose published slug changes', () => {
  let strapi: Core.Strapi
  let base: string
  let site: string
  let siteSlug: string
  let apiToken: string
  let actor: { kind: 'user'; id: number; roles: string[] }
  const guides = () => strapi.documents(GUIDE)
  const redirects = () => strapi.documents(REDIRECTS)
  const transitions = () => strapi.plugin('micelio').service('transitions') as TransitionsService

  const move = (documentId: string, to: 'in_review' | 'published' | 'draft') =>
    transitions().perform({ uid: GUIDE, documentId, locale: 'en', to, actor })

  /** A guide in review under this slug, or published with it. */
  async function guideOf(slug: string, options: { publish?: boolean } = {}): Promise<string> {
    const created = await guides().create({
      locale: 'en',
      data: { title: 'A guide', slug, site, sections: [] } as never,
    })
    await move(created.documentId, 'in_review')
    if (options.publish) await move(created.documentId, 'published')
    return created.documentId
  }

  const rename = (documentId: string, slug: string) =>
    guides().update({ documentId, locale: 'en', data: { slug } as never })

  /** Renames the draft and publishes it again. */
  async function republishAs(documentId: string, slug: string): Promise<void> {
    await rename(documentId, slug)
    await move(documentId, 'published')
  }

  async function stored(): Promise<{ from: string; to: string }[]> {
    const rows = (await redirects().findMany({
      filters: { site: { documentId: site } },
      sort: ['from:asc'],
    } as never)) as unknown as { from: string; to: string }[]
    return rows.map(({ from, to }) => ({ from, to }))
  }

  const list = (query = `?site=${siteSlug}`, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/micelio/redirects${query}`, {
      headers: { Authorization: `Bearer ${apiToken}`, ...headers },
    })

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    const row = (await strapi.documents(SITE_UID as UID.ContentType).findFirst({}))!
    site = row.documentId
    siteSlug = row.slug as string
    apiToken = (
      (await strapi.service('admin::api-token').create({
        name: 'redirects-suite',
        type: 'custom',
        lifespan: null,
        permissions: ['plugin::micelio.redirects.find'],
      })) as { accessKey: string }
    ).accessKey
    const role = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    const user = await strapi.service('admin::user').create({
      email: 'redirects@example.com',
      firstname: 'Redirect',
      lastname: 'Suite',
      password: 'Password1234',
      roles: [role.id],
      isActive: true,
    })
    actor = { kind: 'user', id: user.id as number, roles: ['strapi-super-admin'] }
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  beforeEach(async () => {
    for (const { documentId } of (await redirects().findMany({})) as unknown as {
      documentId: string
    }[]) {
      await redirects().delete({ documentId })
    }
  })

  it('publishing a slug change creates the redirect', async () => {
    const documentId = await guideOf('open-source-explained', { publish: true })
    expect(await stored()).toEqual([])

    await republishAs(documentId, 'open-source')

    expect(await stored()).toEqual([{ from: '/open-source-explained', to: '/open-source' }])
    const [row] = (await redirects().findMany({
      populate: { site: { fields: ['documentId'] } },
    } as never)) as unknown as { rule: string; entryLocale: string; site: { documentId: string } }[]
    expect(row).toMatchObject({
      rule: 'slug-change',
      entryLocale: 'en',
      site: { documentId: site },
    })
  })

  it('writes no redirect for a first publish, a republish under the same slug or a draft', async () => {
    const documentId = await guideOf('first', { publish: true })
    await move(documentId, 'published')
    // A draft's slug changes no address: the live version still answers `/first`.
    await rename(documentId, 'second')
    expect(await stored()).toEqual([])
    // A page that is not live has no address to keep.
    await move(documentId, 'draft')
    await move(documentId, 'in_review')
    await republishAs(documentId, 'third')
    expect(await stored()).toEqual([])
  })

  it('writes no redirect for a type that was not made with withPageSettings', async () => {
    const memo = await strapi
      .documents(MEMO)
      .create({ data: { title: 'A memo', slug: 'one', site } })
    const transitions = strapi.plugin('micelio').service('transitions') as TransitionsService
    const perform = (to: 'in_review' | 'published') =>
      transitions.perform({ uid: MEMO, documentId: memo.documentId, to, actor })
    await perform('in_review')
    await perform('published')
    await strapi
      .documents(MEMO)
      .update({ documentId: memo.documentId, data: { slug: 'two' } as never })
    await perform('published')
    const live = (await strapi
      .documents(MEMO)
      .findOne({ documentId: memo.documentId, status: 'published' })) as unknown as { slug: string }
    expect(live.slug).toBe('two')
    expect(await stored()).toEqual([])
  })

  it('points an older redirect at the new address instead of chaining', async () => {
    const documentId = await guideOf('one', { publish: true })
    await republishAs(documentId, 'two')
    await republishAs(documentId, 'three')
    expect(await stored()).toEqual([
      { from: '/one', to: '/three' },
      { from: '/two', to: '/three' },
    ])
  })

  it('drops the redirect from an address the page returns to', async () => {
    const documentId = await guideOf('one', { publish: true })
    await republishAs(documentId, 'two')
    await republishAs(documentId, 'one')
    expect(await stored()).toEqual([{ from: '/two', to: '/one' }])
  })

  it('writes the redirect and the publish in one transaction', async () => {
    const documentId = await guideOf('stays', { publish: true })
    await rename(documentId, 'moves')
    const unsubscribe = strapi.db.lifecycles.subscribe({
      models: [REDIRECT_UID],
      beforeCreate() {
        throw new Error('the redirect cannot be written')
      },
    })
    try {
      await expect(move(documentId, 'published')).rejects.not.toBeInstanceOf(TransitionError)
    } finally {
      unsubscribe()
    }
    // Nothing of the publish stands: the live page keeps its address and no redirect exists.
    const live = (await guides().findOne({
      documentId,
      locale: 'en',
      status: 'published',
    })) as unknown as { slug: string }
    expect(live.slug).toBe('stays')
    expect(await stored()).toEqual([])
  })

  it('the list answers with an ETag', async () => {
    const documentId = await guideOf('before', { publish: true })
    await republishAs(documentId, 'after')

    const first = await list()
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ data: [{ from: '/before', to: '/after', locale: 'en' }] })
    const etag = first.headers.get('etag')
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{43}"$/)
    expect(first.headers.get('cache-control')).toBe('public, max-age=60')

    // The same tag with nothing changed is `304` with no body; a changed list is a new tag.
    const again = await list(`?site=${siteSlug}`, { 'If-None-Match': etag! })
    expect(again.status).toBe(304)
    expect(await again.text()).toBe('')
    await republishAs(documentId, 'later')
    const changed = await list(`?site=${siteSlug}`, { 'If-None-Match': etag! })
    expect(changed.status).toBe(200)
    expect(changed.headers.get('etag')).not.toBe(etag)
  })

  it('answers the redirects of the site the request names, and refuses an unknown one', async () => {
    const documentId = await guideOf('here', { publish: true })
    await republishAs(documentId, 'there')
    const other = await strapi.documents(SITE_UID as UID.ContentType).create({
      data: {
        name: 'Other',
        slug: 'other',
        hosts: ['other.test'],
        isDefault: false,
        defaultLocale: 'en',
        modules: {},
      } as never,
    })
    expect(other.documentId).toBeTruthy()
    expect(await (await list('?site=other')).json()).toEqual({ data: [] })
    const missing = await list('?site=nowhere')
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { code: string }).code).toBe('unknownSite')
  })

  it('refuses a token that lacks the permission', async () => {
    const token = (
      (await strapi.service('admin::api-token').create({
        name: 'redirects-no-grant',
        type: 'custom',
        lifespan: null,
        permissions: ['plugin::micelio.preview.draft'],
      })) as { accessKey: string }
    ).accessKey
    const response = await fetch(`${base}/api/micelio/redirects?site=${siteSlug}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(403)
    const anonymous = await fetch(`${base}/api/micelio/redirects?site=${siteSlug}`)
    expect(anonymous.status).toBe(401)
  })

  const BAD_PATHS = [
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    '/a\nb',
  ]

  it('refuses a from or a to that is not a path of the site, on every write', async () => {
    for (const bad of BAD_PATHS) {
      for (const field of ['from', 'to']) {
        const data = { from: '/a', to: '/b', site, rule: 'slug-change', [field]: bad }
        await expect(redirects().create({ data: data as never })).rejects.toMatchObject({
          name: 'ValidationError',
          details: { code: 'redirectInvalid', field },
        })
      }
    }
    expect(await stored()).toEqual([])
    const ok = await redirects().create({
      data: { from: '/a', to: '/b', site, rule: 'slug-change' } as never,
    })
    await expect(
      redirects().update({ documentId: ok.documentId, data: { to: '//evil.example' } as never })
    ).rejects.toMatchObject({ details: { code: 'redirectInvalid', field: 'to' } })
    expect(await stored()).toEqual([{ from: '/a', to: '/b' }])
  })

  it('refuses the Content Manager duplicate of a redirect into an off-site to', async () => {
    const ok = await redirects().create({
      data: { from: '/a', to: '/b', site, rule: 'slug-change' } as never,
    })
    await expect(
      redirects().clone({ documentId: ok.documentId, data: { to: '//evil.example' } as never })
    ).rejects.toMatchObject({ details: { code: 'redirectInvalid', field: 'to' } })
    expect(await stored()).toEqual([{ from: '/a', to: '/b' }])
  })

  it('never serves a redirect that is not a path of the site, and still serves a valid one', async () => {
    await redirects().create({ data: { from: '/a', to: '/b', site, rule: 'slug-change' } as never })
    // Written under the document service, as a restore or a database edit would.
    const siteRow = (await strapi.db.query(SITE_UID).findOne({ where: { documentId: site } }))!
    for (const [i, bad] of BAD_PATHS.entries()) {
      await strapi.db.query(REDIRECTS).create({
        data: { from: `/x${i}`, to: bad, rule: 'slug-change', site: siteRow.id },
      })
    }
    const body = (await (await list()).json()) as { data: { from: string; to: string }[] }
    expect(body.data.map(({ from, to }) => ({ from, to }))).toEqual([{ from: '/a', to: '/b' }])
  })

  it('shows the type of a redirect in the Content Manager', () => {
    const schema = strapi.contentType(REDIRECTS) as unknown as {
      pluginOptions: { 'content-manager'?: { visible?: boolean } }
    }
    expect(schema.pluginOptions['content-manager']?.visible).toBe(true)
  })
})
