import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { PREVIEW_CREDENTIAL_UID, PREVIEW_PERMISSION } from '../../server/src/constants/preview'
import { REUSABLE_BLOCK_UID } from '../../server/src/constants/reusable-blocks'
import type { Actor } from '../../server/src/editorial/machine'
import type { PreviewService } from '../../server/src/services/preview'
import type { TransitionsService } from '../../server/src/services/transitions'
import type { PreviewTarget } from '../../server/src/types/preview'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'

// Fixture types made with `withSiteScope` (test/strapi/app/src/api/): `article` has draft and
// publish and is not localised, `essay` is localised, `note` has neither.
const ARTICLE_UID = 'api::article.article'
const ESSAY_UID = 'api::essay.essay'
const NOTE_UID = 'api::note.note'
const PASSWORD = 'Password1234'
const ADMIN_ORIGIN = 'https://admin.example.com'

type Role = 'strapi-super-admin' | 'strapi-editor' | 'strapi-author'

interface Problem {
  status: number
  code: string
  detail: string
}

interface Reader {
  id: number
  roleId: number
  token: string
}

interface LogTransport {
  log: (info: Record<string | symbol, unknown>, next: () => void) => void
}

interface Credential {
  kind: string
  hash: string
  adminUser: number | null
  adminOrigin: string | null
  entryVersion: string | null
  siteDocumentId: string
  contentType: string
  entryDocumentId: string
  entryLocale: string | null
  expiresAt: string
  usedAt: string | null
  revokedAt: string | null
}

describe('the preview token, the grant exchange and the draft by grant', () => {
  let strapi: Core.Strapi
  let base: string
  let site: string
  let otherSite: string
  let articleId: string
  let apiToken: string
  let counter = 0
  /** Every token and grant value the helpers have seen, for the log test. */
  const issued: string[] = []
  const adminTokens = {} as Record<Role, string>
  /** A super admin of its own for each group: the token route is rate limited per user. */
  let admin: string
  const sites = () => strapi.documents(SITE_UID as UID.ContentType)
  const credentials = () => strapi.db.query(PREVIEW_CREDENTIAL_UID)

  async function signIn(email: string): Promise<string> {
    const response = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    return ((await response.json()) as { data: { token: string } }).data.token
  }

  async function createUser(email: string, roleId: number): Promise<number> {
    const user = (await strapi.service('admin::user').create({
      email,
      firstname: email,
      lastname: 'Test',
      password: PASSWORD,
      roles: [roleId],
      isActive: true,
    })) as { id: number }
    return user.id
  }

  async function freshSuperAdmin(): Promise<string> {
    counter += 1
    const email = `super-admin-${counter}@example.com`
    await createUser(email, await roleId('strapi-super-admin'))
    return signIn(email)
  }

  async function roleId(code: Role): Promise<number> {
    return ((await strapi.db.query('admin::role').findOne({ where: { code } })) as { id: number })
      .id
  }

  const previewPermission = {
    action: PREVIEW_PERMISSION,
    subject: null,
    conditions: [],
    properties: {},
  }
  const readPermission = (uid: string) => ({
    action: 'plugin::content-manager.explorer.read',
    subject: uid,
    conditions: [],
    properties: { fields: ['title', 'site'] },
  })

  /** A user whose role may preview and read articles, and nothing else. */
  async function newReader(): Promise<Reader> {
    counter += 1
    const role = (await strapi
      .service('admin::role')
      .create({ name: `Reader ${counter}`, code: `reader-${counter}` })) as { id: number }
    await strapi
      .service('admin::role')
      .addPermissions(role.id, [previewPermission, readPermission(ARTICLE_UID)])
    const email = `reader-${counter}@example.com`
    const id = await createUser(email, role.id)
    return { id, roleId: role.id, token: await signIn(email) }
  }

  function askToken(
    token: string,
    body: unknown,
    origin: string | null = ADMIN_ORIGIN
  ): Promise<Response> {
    return fetch(`${base}/micelio/preview/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(body),
    })
  }

  function exchange(token: unknown, query = '', key = apiToken): Promise<Response> {
    return fetch(`${base}/api/micelio/preview/exchange${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ token }),
    })
  }

  function draftOf(
    grant: string,
    query: Record<string, string>,
    key = apiToken
  ): Promise<Response> {
    return fetch(`${base}/api/micelio/preview/draft?${new URLSearchParams(query)}`, {
      headers: { Authorization: `Bearer ${key}`, 'X-Micelio-Preview-Grant': grant },
    })
  }

  const body = (documentId = articleId, extra: Record<string, unknown> = {}) => ({
    uid: ARTICLE_UID,
    documentId,
    ...extra,
  })

  /** Asks for a token and returns its value. */
  async function tokenFor(token: string, request: unknown = body()): Promise<string> {
    const response = await askToken(token, request)
    expect(response.status).toBe(200)
    const { data } = (await response.json()) as { data: { url: string } }
    const value = new URL(data.url).searchParams.get('token')!
    issued.push(value)
    return value
  }

  async function grantFor(token: string, request: unknown = body()): Promise<string> {
    const response = await exchange(await tokenFor(token, request))
    expect(response.status).toBe(200)
    const { grant } = ((await response.json()) as { data: { grant: string } }).data
    issued.push(grant)
    return grant
  }

  /** The `updatedAt` of an article's draft, the version a system grant is minted for. */
  async function versionOf(
    documentId: string,
    uid = ARTICLE_UID,
    locale?: string
  ): Promise<string> {
    const draft = (await strapi
      .documents(uid as UID.ContentType)
      .findOne({ documentId, status: 'draft', locale } as never)) as unknown as {
      updatedAt: string | Date
    }
    return new Date(draft.updatedAt).toISOString()
  }

  /** Mints a system grant as plugin code does, for an article's current draft unless told otherwise. */
  async function systemGrantFor(
    documentId = articleId,
    overrides: Partial<
      Extract<Parameters<PreviewService['issueSystemGrant']>[0], { entryVersion: string }>
    > = {}
  ): Promise<string> {
    const grant = await (
      strapi.plugin('micelio').service('preview') as PreviewService
    ).issueSystemGrant({
      siteDocumentId: site,
      contentType: ARTICLE_UID,
      entryDocumentId: documentId,
      entryLocale: null,
      ...overrides,
      entryVersion: overrides.entryVersion ?? (await versionOf(documentId)),
    })
    issued.push(grant)
    return grant
  }

  const rowOf = async (value: string) =>
    (await credentials().findOne({
      where: { hash: createHash('sha256').update(value).digest('hex') },
    })) as Credential

  async function createArticle(userToken: string): Promise<string> {
    const created = await fetch(`${base}/content-manager/collection-types/${ARTICLE_UID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: 'A draft', site }),
    })
    expect(created.status).toBe(201)
    return ((await created.json()) as { data: { documentId: string } }).data.documentId
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const { port } = strapi.server.httpServer.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    site = (await sites().findFirst({}))!.documentId
    await sites().update({ documentId: site, data: { url: 'https://example.com:8443' } } as never)
    otherSite = (
      await sites().create({
        data: {
          name: 'Other',
          slug: 'other',
          hosts: ['other.test'],
          isDefault: false,
          defaultLocale: 'en',
          modules: {},
        },
      } as never)
    ).documentId
    for (const code of ['strapi-super-admin', 'strapi-editor', 'strapi-author'] as const) {
      const email = `${code}@example.com`
      await createUser(email, await roleId(code))
      adminTokens[code] = await signIn(email)
    }
    await strapi
      .service('admin::role')
      .addPermissions(await roleId('strapi-author'), [previewPermission])
    articleId = await createArticle(adminTokens['strapi-editor'])
    apiToken = (
      (await strapi.service('admin::api-token').create({
        name: 'preview-test',
        type: 'full-access',
        lifespan: null,
      })) as { accessKey: string }
    ).accessKey
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  describe('POST /micelio/preview/token', () => {
    beforeAll(async () => {
      admin = await freshSuperAdmin()
    })

    it('answers the frontend URL with an opaque token for the default site', async () => {
      const before = Date.now()
      const response = await askToken(admin, body())
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      const { data } = (await response.json()) as { data: { url: string; expiresAt: string } }
      const url = new URL(data.url)
      expect(url.origin).toBe('https://example.com:8443')
      expect(url.pathname).toBe('/_preview')
      expect([...url.searchParams.keys()]).toEqual(['token'])
      expect(url.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(new Date(data.expiresAt).getTime()).toBeGreaterThanOrEqual(before + 60_000)
      expect(new Date(data.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 60_000)
    })

    it('stores only the hash, bound to the admin user, origin, site, type, document and locale', async () => {
      const value = await tokenFor(admin)
      const hash = createHash('sha256').update(value).digest('hex')
      const rows = (await credentials().findMany({})) as Credential[]
      const row = rows.find((candidate) => candidate.hash === hash)
      expect(row).toMatchObject({
        kind: 'token',
        adminOrigin: ADMIN_ORIGIN,
        siteDocumentId: site,
        contentType: ARTICLE_UID,
        entryDocumentId: articleId,
        entryLocale: null,
        usedAt: null,
        revokedAt: null,
      })
      expect(JSON.stringify(rows)).not.toContain(value)
    })

    it('binds the locale of the draft found, not the one asked', async () => {
      const essays = strapi.documents(ESSAY_UID as UID.ContentType)
      const { documentId } = await essays.create({
        locale: 'en',
        data: { title: 'An essay', site },
      } as never)
      const find = async (request: Record<string, unknown>) => {
        const value = await tokenFor(admin, {
          uid: ESSAY_UID,
          documentId,
          ...request,
        })
        const hash = createHash('sha256').update(value).digest('hex')
        return ((await credentials().findOne({ where: { hash } })) as Credential).entryLocale
      }
      expect(await find({})).toBe('en')
      expect(await find({ locale: 'en' })).toBe('en')
      // A locale sent for a type that is not localised is not bound.
      const value = await tokenFor(admin, body(articleId, { locale: 'en' }))
      const hash = createHash('sha256').update(value).digest('hex')
      expect(
        ((await credentials().findOne({ where: { hash } })) as Credential).entryLocale
      ).toBeNull()
    })

    it('previews a type without draft and publish', async () => {
      const note = await strapi
        .documents(NOTE_UID as UID.ContentType)
        .create({ data: { title: 'A note', site } } as never)
      const response = await askToken(admin, {
        uid: NOTE_UID,
        documentId: note.documentId,
      })
      expect(response.status).toBe(200)
    })

    it('refuses a draft the role cannot read with previewForbidden', async () => {
      // The author has the permission, but reads only their own entries.
      const response = await askToken(adminTokens['strapi-author'], body())
      expect(response.status).toBe(403)
      expect(response.headers.get('content-type')).toContain('application/problem+json')
      expect((await response.json()) as Problem).toMatchObject({
        status: 403,
        code: 'previewForbidden',
      })
      const own = await createArticle(adminTokens['strapi-author'])
      expect((await askToken(adminTokens['strapi-author'], body(own))).status).toBe(200)
    })

    it('refuses a role without the preview permission with previewForbidden', async () => {
      const response = await askToken(adminTokens['strapi-editor'], body())
      expect(response.status).toBe(403)
      expect((await response.json()) as Problem).toMatchObject({ code: 'previewForbidden' })
    })

    it('refuses a request without an admin session', async () => {
      const response = await fetch(`${base}/micelio/preview/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body()),
      })
      expect(response.status).toBe(401)
    })

    it.each([
      ['no body fields', {}, 400, 'previewRequestInvalid'],
      [
        'a locale that is not a string',
        body(undefined, { locale: 3 }),
        400,
        'previewRequestInvalid',
      ],
      [
        'a type that belongs to no site',
        { uid: 'admin::user', documentId: 'x' },
        400,
        'previewTypeInvalid',
      ],
      ['a document that does not exist', body('missing'), 404, 'previewEntryNotFound'],
    ])('answers %s with %s %s', async (_name, request, status, code) => {
      const response = await askToken(admin, request)
      expect(response.status).toBe(status)
      expect((await response.json()) as Problem).toMatchObject({ code })
    })

    it('answers previewUnavailable for a site without a url', async () => {
      const bare = await strapi
        .documents(NOTE_UID as UID.ContentType)
        .create({ data: { title: 'On a bare site', site: otherSite } } as never)
      const response = await askToken(admin, {
        uid: NOTE_UID,
        documentId: bare.documentId,
      })
      expect(response.status).toBe(409)
      expect((await response.json()) as Problem).toMatchObject({ code: 'previewUnavailable' })
    })
  })

  describe('POST /api/micelio/preview/exchange', () => {
    beforeAll(async () => {
      admin = await freshSuperAdmin()
    })

    it('gives a grant once and refuses the second use', async () => {
      const value = await tokenFor(admin)
      const first = await exchange(value)
      expect(first.status).toBe(200)
      expect(first.headers.get('cache-control')).toBe('private, no-store')
      const { data } = (await first.json()) as {
        data: {
          grant: string
          expiresAt: string
          adminOrigin: string
          documentId: string
          locale: null
        }
      }
      expect(data).toMatchObject({ adminOrigin: ADMIN_ORIGIN, documentId: articleId, locale: null })
      expect(data.grant).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000)
      expect(new Date(data.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000)

      const second = await exchange(value)
      expect(second.status).toBe(404)
      expect((await second.json()) as Problem).toMatchObject({ code: 'previewRefused' })
    })

    it('stores the grant hashed and marks the token used', async () => {
      const value = await tokenFor(admin)
      const response = await exchange(value)
      const grant = ((await response.json()) as { data: { grant: string } }).data.grant
      const hashOf = (text: string) => createHash('sha256').update(text).digest('hex')
      const rows = (await credentials().findMany({})) as Credential[]
      expect(rows.find((row) => row.hash === hashOf(value))?.usedAt).not.toBeNull()
      expect(rows.find((row) => row.hash === hashOf(grant))).toMatchObject({
        kind: 'grant',
        entryDocumentId: articleId,
        revokedAt: null,
      })
      expect(JSON.stringify(rows)).not.toContain(grant)
    })

    it('lets only one of two simultaneous exchanges win', async () => {
      const value = await tokenFor(admin)
      const statuses = (await Promise.all([exchange(value), exchange(value)])).map((r) => r.status)
      expect(statuses.sort()).toEqual([200, 404])
    })

    it('refuses an expired, unknown, wrong-site and wrong-kind credential with the same answer', async () => {
      const expired = await tokenFor(admin)
      await credentials().updateMany({
        where: { hash: createHash('sha256').update(expired).digest('hex') },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      const grant = await grantFor(admin)
      const live = await tokenFor(admin)
      const answers = await Promise.all([
        exchange(expired),
        exchange('not-a-token'),
        exchange(live, '?site=other'),
        exchange(grant),
      ])
      const texts = await Promise.all(answers.map((answer) => answer.text()))
      expect(answers.map((answer) => answer.status)).toEqual([404, 404, 404, 404])
      expect(new Set(texts).size).toBe(1)
      expect(JSON.parse(texts[0]!)).toMatchObject({ code: 'previewRefused' })
    })

    it('needs an API token that allows the exchange: read-only is refused, a custom one works', async () => {
      const make = async (attributes: Record<string, unknown>): Promise<string> =>
        (
          (await strapi.service('admin::api-token').create({
            lifespan: null,
            ...attributes,
          })) as { accessKey: string }
        ).accessKey
      const readOnly = await make({ name: 'preview-read-only', type: 'read-only' })
      const custom = await make({
        name: 'preview-custom',
        type: 'custom',
        permissions: ['plugin::micelio.preview.exchange', 'plugin::micelio.preview.draft'],
      })
      expect((await exchange(await tokenFor(admin), '', readOnly)).status).toBe(403)
      const grant = await (await exchange(await tokenFor(admin), '', custom)).json()
      expect((grant as { data: { grant: string } }).data.grant).toBeTruthy()
      const found = await draftOf(
        (grant as { data: { grant: string } }).data.grant,
        { documentId: articleId },
        custom
      )
      expect(found.status).toBe(200)
    })

    it('answers 400 to a body without a token, and 401 without the frontend API token', async () => {
      expect((await exchange(undefined)).status).toBe(400)
      expect((await exchange('x', '', 'not-an-api-token')).status).toBe(401)
      const withAdminToken = await exchange('x', '', admin)
      expect(withAdminToken.status).toBe(401)
    })

    it('refuses a token whose admin user lost the right to read the draft', async () => {
      const reader = await newReader()
      const own = await createArticle(admin)
      const value = await tokenFor(reader.token, body(own))
      await strapi.service('admin::role').assignPermissions(reader.roleId, [previewPermission])
      expect((await exchange(value)).status).toBe(404)
    })
  })

  describe('GET /api/micelio/preview/draft', () => {
    beforeAll(async () => {
      admin = await freshSuperAdmin()
    })

    it('serves the draft the grant names, and only that one', async () => {
      const grant = await grantFor(admin)
      const response = await draftOf(grant, { documentId: articleId })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      const { data } = (await response.json()) as { data: { documentId: string; title: string } }
      expect(data).toMatchObject({ documentId: articleId, title: 'A draft' })

      const another = await createArticle(adminTokens['strapi-editor'])
      const refused = await draftOf(grant, { documentId: another })
      expect(refused.status).toBe(404)
      expect((await refused.json()) as Problem).toMatchObject({ code: 'previewRefused' })
    })

    it('serves the draft, not the published version', async () => {
      const id = await createArticle(adminTokens['strapi-editor'])
      const articles = strapi.documents(ARTICLE_UID as UID.ContentType)
      for (const to of ['in_review', 'published']) {
        const moved = await fetch(`${base}/micelio/transitions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
          body: JSON.stringify({ uid: ARTICLE_UID, documentId: id, to }),
        })
        expect(moved.status).toBe(200)
      }
      await articles.update({ documentId: id, data: { title: 'Edited draft' } } as never)
      const grant = await grantFor(admin, body(id))
      const response = await draftOf(grant, { documentId: id })
      expect(((await response.json()) as { data: { title: string } }).data.title).toBe(
        'Edited draft'
      )
    })

    it('refuses another locale and serves the locale the grant names', async () => {
      const essays = strapi.documents(ESSAY_UID as UID.ContentType)
      const { documentId } = await essays.create({
        locale: 'en',
        data: { title: 'Essay', site },
      } as never)
      const grant = await grantFor(admin, {
        uid: ESSAY_UID,
        documentId,
      })
      expect((await draftOf(grant, { documentId })).status).toBe(200)
      expect((await draftOf(grant, { documentId, locale: 'en' })).status).toBe(200)
      expect((await draftOf(grant, { documentId, locale: 'es' })).status).toBe(404)
    })

    it('refuses a grant of another site, a token used as a grant and an unknown grant alike', async () => {
      const grant = await grantFor(admin)
      const token = await tokenFor(admin)
      const answers = await Promise.all([
        draftOf(grant, { documentId: articleId, site: 'other' }),
        draftOf(token, { documentId: articleId }),
        draftOf('not-a-grant', { documentId: articleId }),
      ])
      const texts = await Promise.all(answers.map((answer) => answer.text()))
      expect(answers.map((answer) => answer.status)).toEqual([404, 404, 404])
      expect(new Set(texts).size).toBe(1)
    })

    it('answers 400 without the grant header or the documentId, and 401 without the API token', async () => {
      const grant = await grantFor(admin)
      expect((await draftOf('', { documentId: articleId })).status).toBe(400)
      expect((await draftOf(grant, {})).status).toBe(400)
      expect((await draftOf(grant, { documentId: articleId }, 'not-an-api-token')).status).toBe(401)
    })

    it('revokes the grants of a user who loses the right to read the draft', async () => {
      const reader = await newReader()
      const own = await createArticle(admin)
      const grant = await grantFor(reader.token, body(own))
      expect((await draftOf(grant, { documentId: own })).status).toBe(200)

      await strapi.service('admin::role').assignPermissions(reader.roleId, [previewPermission])
      expect((await draftOf(grant, { documentId: own })).status).toBe(404)
      const row = (await credentials().findOne({
        where: { hash: createHash('sha256').update(grant).digest('hex') },
      })) as Credential
      expect(row.revokedAt).not.toBeNull()

      // Giving the permission back does not bring the grant back.
      await strapi
        .service('admin::role')
        .addPermissions(reader.roleId, [readPermission(ARTICLE_UID)])
      expect((await draftOf(grant, { documentId: own })).status).toBe(404)
    })

    it('revokes every grant of a user who logs out of the admin', async () => {
      const reader = await newReader()
      const own = await createArticle(admin)
      const grant = await grantFor(reader.token, body(own))
      const unused = await tokenFor(reader.token, body(own))
      expect((await draftOf(grant, { documentId: own })).status).toBe(200)

      const logout = await fetch(`${base}/admin/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${reader.token}` },
        body: '{}',
      })
      expect(logout.status).toBe(200)
      expect((await draftOf(grant, { documentId: own })).status).toBe(404)
      expect((await exchange(unused)).status).toBe(404)
    })

    it.each(['/admin/logout', '/admin/logout/', '/ADMIN/logout'])(
      'has revoked the grants when the logout answers, even when the revocation is slow (%s)',
      async (path) => {
        const reader = await newReader()
        const own = await createArticle(admin)
        const grant = await grantFor(reader.token, body(own))
        const service = strapi.plugin('micelio').service('preview') as PreviewService
        const revoke = service.revoke.bind(service)
        const slow = vi.spyOn(service, 'revoke').mockImplementation(async (...args) => {
          await new Promise((resolve) => setTimeout(resolve, 300))
          await revoke(...args)
        })
        try {
          const logout = await fetch(`${base}${path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${reader.token}`,
            },
            body: '{}',
          })
          expect(logout.status).toBe(200)
          expect(slow).toHaveBeenCalled()
          expect((await draftOf(grant, { documentId: own })).status).toBe(404)
        } finally {
          slow.mockRestore()
        }
      }
    )

    it('does not revoke the grants on another admin route', async () => {
      const reader = await newReader()
      const own = await createArticle(admin)
      const grant = await grantFor(reader.token, body(own))
      const other = await fetch(`${base}/admin/users/me`, {
        headers: { Authorization: `Bearer ${reader.token}` },
      })
      expect(other.status).toBe(200)
      expect((await draftOf(grant, { documentId: own })).status).toBe(200)
    })

    it('refuses a draft request sent right after each of 200 logouts has answered', async () => {
      const reader = await newReader()
      const own = await createArticle(admin)
      const service = strapi.plugin('micelio').service('preview') as PreviewService
      const served: number[] = []
      for (let round = 0; round < 200; round += 1) {
        // A user of its own for each round: the admin login is rate limited per user.
        const email = `logout-${counter}-${round}@example.com`
        const userId = await createUser(email, reader.roleId)
        const token = await signIn(email)
        const { url } = await service.issueToken({
          adminUser: userId,
          adminOrigin: ADMIN_ORIGIN,
          siteDocumentId: site,
          contentType: ARTICLE_UID,
          entryDocumentId: own,
          entryLocale: null,
        })
        const answer = await service.exchange(new URL(url).searchParams.get('token')!, site)
        const grant = answer!.grant
        issued.push(grant)
        const logout = await fetch(`${base}/admin/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: '{}',
        })
        expect(logout.status).toBe(200)
        // No waiting: ADR-0019, section 3 holds from the moment the logout has answered.
        const draft = await draftOf(grant, { documentId: own })
        if (draft.status !== 404) served.push(round)
      }
      expect(served).toEqual([])
    }, 300_000)

    it('refuses a grant whose admin user is deactivated', async () => {
      const reader = await newReader()
      const own = await createArticle(admin)
      const grant = await grantFor(reader.token, body(own))
      await strapi.db
        .query('admin::user')
        .update({ where: { id: reader.id }, data: { isActive: false } })
      expect((await draftOf(grant, { documentId: own })).status).toBe(404)
    })
  })

  describe('a system grant on GET /api/micelio/preview/draft', () => {
    beforeAll(async () => {
      admin = await freshSuperAdmin()
    })

    it('serves the draft it names once and then answers 404 previewRefused', async () => {
      const grant = await systemGrantFor()
      const first = await draftOf(grant, { documentId: articleId })
      expect(first.status).toBe(200)
      expect(first.headers.get('cache-control')).toBe('private, no-store')
      expect(((await first.json()) as { data: { title: string } }).data.title).toBe('A draft')
      const second = await draftOf(grant, { documentId: articleId })
      expect(second.status).toBe(404)
      expect((await second.json()) as Problem).toMatchObject({ code: 'previewRefused' })
      expect((await rowOf(grant)).usedAt).not.toBeNull()
    })

    it('lets only one of two simultaneous checks win', async () => {
      const grant = await systemGrantFor()
      const answers = await Promise.all([
        draftOf(grant, { documentId: articleId }),
        draftOf(grant, { documentId: articleId }),
      ])
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 404])
    })

    it('tells the frontend who it acts for: system for a system grant, admin for an admin one', async () => {
      const system = await draftOf(await systemGrantFor(), { documentId: articleId })
      expect(((await system.json()) as { meta: unknown }).meta).toEqual({ actor: 'system' })
      const admins = await draftOf(await grantFor(admin), { documentId: articleId })
      expect(((await admins.json()) as { meta: unknown }).meta).toEqual({ actor: 'admin' })
    })

    it('is stored as a hash, with no admin user, and lives 60 seconds', async () => {
      const before = Date.now()
      const grant = await systemGrantFor()
      const rows = (await credentials().findMany({})) as Credential[]
      const row = await rowOf(grant)
      expect(row).toMatchObject({
        kind: 'system',
        adminUser: null,
        adminOrigin: null,
        siteDocumentId: site,
        contentType: ARTICLE_UID,
        entryDocumentId: articleId,
        entryLocale: null,
        entryVersion: await versionOf(articleId),
        usedAt: null,
        revokedAt: null,
      })
      expect(new Date(row.expiresAt).getTime()).toBeGreaterThanOrEqual(before + 60_000)
      expect(new Date(row.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 60_000)
      expect(JSON.stringify(rows)).not.toContain(grant)
    })

    it('is refused when expired', async () => {
      const grant = await systemGrantFor()
      await credentials().updateMany({
        where: { hash: (await rowOf(grant)).hash },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      expect((await draftOf(grant, { documentId: articleId })).status).toBe(404)
    })

    it('is refused for another document, locale or site', async () => {
      const another = await createArticle(adminTokens['strapi-editor'])
      const essays = strapi.documents(ESSAY_UID as UID.ContentType)
      const { documentId: essay } = await essays.create({
        locale: 'en',
        data: { title: 'Essay', site },
      } as never)
      const attempts: [string, Record<string, string>][] = [
        [await systemGrantFor(), { documentId: another }],
        [await systemGrantFor(), { documentId: articleId, site: 'other' }],
        [await systemGrantFor(), { documentId: articleId, locale: 'es' }],
      ]
      const answers = await Promise.all(attempts.map(([grant, query]) => draftOf(grant, query)))
      expect(answers.map((answer) => answer.status)).toEqual([404, 404, 404])
      const texts = await Promise.all(answers.map((answer) => answer.text()))
      expect(new Set(texts).size).toBe(1)
      // A localised draft is served only in the locale it was minted for.
      const version = await versionOf(essay, ESSAY_UID, 'en')
      const minted = (overrides: object) =>
        systemGrantFor(essay, {
          contentType: ESSAY_UID,
          entryLocale: 'en',
          entryVersion: version,
          ...overrides,
        })
      expect((await draftOf(await minted({}), { documentId: essay, locale: 'es' })).status).toBe(
        404
      )
      expect((await draftOf(await minted({}), { documentId: essay, locale: 'en' })).status).toBe(
        200
      )
    })

    it('is refused when the draft was saved after it was minted', async () => {
      const id = await createArticle(adminTokens['strapi-editor'])
      const grant = await systemGrantFor(id)
      await new Promise((resolve) => setTimeout(resolve, 20))
      await strapi
        .documents(ARTICLE_UID as UID.ContentType)
        .update({ documentId: id, data: { title: 'Saved again' } } as never)
      const answer = await draftOf(grant, { documentId: id })
      expect(answer.status).toBe(404)
      expect((await answer.json()) as Problem).toMatchObject({ code: 'previewRefused' })
      // The same document, minted again for the new version, is served.
      expect((await draftOf(await systemGrantFor(id), { documentId: id })).status).toBe(200)
    })

    it('refuses a query that leaves updatedAt out of the answer, so the version is never read from a trimmed one', async () => {
      const id = await createArticle(adminTokens['strapi-editor'])
      const grant = await systemGrantFor(id, { entryVersion: '2020-01-01T00:00:00.000Z' })
      const answer = await draftOf(grant, { documentId: id, 'fields[0]': 'title' })
      expect(answer.status).toBe(400)
      expect((await answer.json()) as Problem).toMatchObject({ code: 'previewRequestInvalid' })
      // With the whole answer the stale version is compared and refused.
      expect((await draftOf(grant, { documentId: id, populate: '*' })).status).toBe(404)
    })

    it('is refused by the exchange, whatever the site, and is not spent by it', async () => {
      const grant = await systemGrantFor()
      const answer = await exchange(grant)
      expect(answer.status).toBe(404)
      expect((await answer.json()) as Problem).toMatchObject({ code: 'previewRefused' })
      expect((await rowOf(grant)).usedAt).toBeNull()
      expect((await draftOf(grant, { documentId: articleId })).status).toBe(200)
    })

    it('is not a token or grant of an admin user: a token and a grant are refused as it', async () => {
      const token = await tokenFor(admin)
      expect((await draftOf(token, { documentId: articleId })).status).toBe(404)
    })

    it('is not revoked by logging an admin user out, while an admin grant is', async () => {
      const reader = await newReader()
      const own = await createArticle(admin)
      const adminGrant = await grantFor(reader.token, body(own))
      const system = await systemGrantFor(own)
      const logout = await fetch(`${base}/admin/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${reader.token}` },
        body: '{}',
      })
      expect(logout.status).toBe(200)
      expect((await rowOf(adminGrant)).revokedAt).not.toBeNull()
      expect((await rowOf(system)).revokedAt).toBeNull()
      expect((await draftOf(adminGrant, { documentId: own })).status).toBe(404)
      expect((await draftOf(system, { documentId: own })).status).toBe(200)
    })

    it('has no controller action or route that mints it', async () => {
      const controller = strapi.plugin('micelio').controller('preview') as object
      expect(Object.keys(controller).sort()).toEqual(['draft', 'exchange', 'token'])
      const routes = Object.values(strapi.plugin('micelio').routes).flatMap(
        (set) => (set as { routes: { path: string }[] }).routes
      )
      const previewPaths = routes.map((route) => route.path).filter((path) => /preview/.test(path))
      expect(previewPaths.sort()).toEqual(['/preview/draft', '/preview/exchange', '/preview/token'])
    })
  })

  describe('a system grant bound to a reference on GET /api/micelio/preview/draft', () => {
    // The page fixture (test/strapi/app/src/api/page/) references reusable blocks through its
    // `section.reusable` component (ADR-0019 and ADR-0022, amendments of 2026-11-23).
    const PAGE_UID = 'api::page.page'
    const POPULATE = { 'populate[sections][on][section.reusable][populate]': 'reusableBlock' }
    let actor: Actor
    const reusables = () => strapi.documents(REUSABLE_BLOCK_UID as UID.ContentType)
    const pages = () => strapi.documents(PAGE_UID as UID.ContentType)
    const previews = () => strapi.plugin('micelio').service('preview') as PreviewService
    const cta = (title: string) => ({ __component: 'section.cta', title })
    const reference = (documentId: string) => ({
      __component: 'section.reusable',
      reusableBlock: documentId,
    })

    async function createBlock(name: string, inSite = site): Promise<string> {
      const created = await reusables().create({
        locale: 'en',
        data: { name, blocks: [cta(name)], site: inSite },
      } as never)
      return created.documentId
    }

    async function publishBlock(documentId: string): Promise<void> {
      const transitions = strapi.plugin('micelio').service('transitions') as TransitionsService
      for (const to of ['in_review', 'published'] as const) {
        await transitions.perform({
          uid: REUSABLE_BLOCK_UID,
          documentId,
          locale: 'en',
          to,
          actor,
        })
      }
    }

    const saveBlock = (documentId: string, name: string) =>
      reusables().update({ documentId, locale: 'en', data: { name } } as never)

    async function createPage(slug: string, sections: unknown[]): Promise<string> {
      const created = await pages().create({
        locale: 'en',
        data: { title: slug, slug, sections, site },
      } as never)
      return created.documentId
    }

    const publishPage = (documentId: string) =>
      pages().publish({ documentId, locale: 'en' } as never)

    /** Mints, as plugin code does, a grant for a page with the block's current draft in place. */
    async function referenceGrantFor(
      page: string,
      block: string,
      overrides: Partial<PreviewTarget> = {}
    ): Promise<string> {
      const grant = await previews().issueSystemGrant({
        siteDocumentId: site,
        contentType: PAGE_UID,
        entryDocumentId: page,
        entryLocale: 'en',
        reusableBlock: {
          documentId: block,
          version: await versionOf(block, REUSABLE_BLOCK_UID, 'en'),
        },
        ...overrides,
      })
      issued.push(grant)
      return grant
    }

    const read = (grant: string, page: string, query: Record<string, string> = {}) =>
      draftOf(grant, { documentId: page, locale: 'en', ...POPULATE, ...query })

    beforeAll(async () => {
      const email = `reference-${Date.now()}@example.com`
      const id = await createUser(email, await roleId('strapi-super-admin'))
      actor = { kind: 'user', id, roles: ['strapi-super-admin'] }
    })

    it("the draft read of a reference grant answers the published page with the reusable block's draft in its place", async () => {
      const block = await createBlock('Banner published')
      const other = await createBlock('Other published')
      await publishBlock(block)
      await publishBlock(other)
      const page = await createPage('shows-a-banner', [reference(block), reference(other)])
      await publishPage(page)
      // Drafts that are not published: the page's own, the block's and another block's.
      await pages().update({
        documentId: page,
        locale: 'en',
        data: { title: 'Page draft' },
      } as never)
      await saveBlock(block, 'Banner draft')
      await saveBlock(other, 'Other draft')
      const version = await versionOf(block, REUSABLE_BLOCK_UID, 'en')

      const answer = await read(await referenceGrantFor(page, block), page)
      expect(answer.status).toBe(200)
      expect(answer.headers.get('cache-control')).toBe('private, no-store')
      const { data, meta } = (await answer.json()) as {
        data: {
          title: string
          sections: { reusableBlock: { documentId: string; name: string } | null }[]
        }
        meta: unknown
      }
      expect(data.title).toBe('shows-a-banner')
      expect(data.sections.map((section) => section.reusableBlock)).toEqual([
        expect.objectContaining({ documentId: block, name: 'Banner draft' }),
        expect.objectContaining({ documentId: other, name: 'Other published' }),
      ])
      expect(meta).toEqual({
        actor: 'system',
        measure: 'reference',
        reusableBlock: { documentId: block, version },
      })
      // The grant of the page's own draft still answers the draft, with its meta unchanged.
      const own = await systemGrantFor(page, {
        contentType: PAGE_UID,
        entryLocale: 'en',
        entryVersion: await versionOf(page, PAGE_UID, 'en'),
      })
      const ownAnswer = await draftOf(own, { documentId: page, locale: 'en', ...POPULATE })
      const ownBody = (await ownAnswer.json()) as { data: { title: string }; meta: unknown }
      expect(ownBody.data.title).toBe('Page draft')
      expect(ownBody.meta).toEqual({ actor: 'system' })
      // The row holds the block and its version, no version of the page, and not the grant.
      const grant = await referenceGrantFor(page, block)
      expect(await rowOf(grant)).toMatchObject({
        kind: 'system',
        adminUser: null,
        entryVersion: null,
        reusableBlockDocumentId: block,
        reusableBlockVersion: version,
      })
    })

    it("the draft read of a reference grant refuses a page with no published version, a page that no longer references the block, another site's block, another page or locale, a spent grant, an expired grant and a saved block", async () => {
      const block = await createBlock('Shared banner')
      await publishBlock(block)
      const live = await createPage('live-page', [reference(block)])
      await publishPage(live)
      const unpublished = await createPage('never-published', [reference(block)])
      const dropped = await createPage('dropped-the-banner', [reference(block)])
      await publishPage(dropped)
      await pages().update({
        documentId: dropped,
        locale: 'en',
        data: { sections: [cta('No banner')] },
      } as never)
      await publishPage(dropped)
      // A block the page references, moved to another site since.
      const moved = await createBlock('Moved banner')
      await publishBlock(moved)
      const keeps = await createPage('keeps-the-moved-banner', [reference(moved)])
      await publishPage(keeps)
      await reusables().update({
        documentId: moved,
        locale: 'en',
        data: { site: otherSite },
      } as never)

      const spent = await referenceGrantFor(live, block)
      expect((await read(spent, live)).status).toBe(200)
      const expired = await referenceGrantFor(live, block)
      await credentials().updateMany({
        where: { hash: (await rowOf(expired)).hash },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      const attempts: [string, string, Record<string, string>?][] = [
        [await referenceGrantFor(unpublished, block), unpublished],
        [await referenceGrantFor(dropped, block), dropped],
        [await referenceGrantFor(keeps, moved), keeps],
        [await referenceGrantFor(live, block), dropped],
        [await referenceGrantFor(live, block), live, { locale: 'es' }],
        [spent, live],
        [expired, live],
      ]
      const answers = []
      for (const [grant, page, query] of attempts) answers.push(await read(grant, page, query))
      // A save of the block's draft after minting, read after the others so it refuses only this one.
      const saved = await referenceGrantFor(live, block)
      await new Promise((resolve) => setTimeout(resolve, 20))
      await saveBlock(block, 'Saved after minting')
      answers.push(await read(saved, live))
      expect(answers.map((answer) => answer.status)).toEqual(Array(attempts.length + 1).fill(404))
      const texts = await Promise.all(answers.map((answer) => answer.text()))
      expect(new Set(texts).size).toBe(1)
      expect(JSON.parse(texts[0]!) as Problem).toMatchObject({ code: 'previewRefused' })
      // The save was refused before the grant was claimed; one minted for it now is served.
      expect((await rowOf(saved)).usedAt).toBeNull()
      expect((await read(await referenceGrantFor(live, block), live)).status).toBe(200)

      // A save between the claim and the read is refused too: the version is read after the page.
      const resolveGrant = previews().resolveGrant.bind(previews())
      const between = vi
        .spyOn(previews(), 'resolveGrant')
        .mockImplementationOnce(async (...args) => {
          const resolved = await resolveGrant(...args)
          await new Promise((resolve) => setTimeout(resolve, 20))
          await saveBlock(block, 'Saved between')
          return resolved
        })
      try {
        const answer = await read(await referenceGrantFor(live, block), live)
        expect(between).toHaveBeenCalledTimes(1)
        expect(answer.status).toBe(404)
      } finally {
        between.mockRestore()
      }
    })

    it('a reference grant is refused by the token exchange', async () => {
      const block = await createBlock('Exchanged banner')
      await publishBlock(block)
      const page = await createPage('exchanged-page', [reference(block)])
      await publishPage(page)
      const grant = await referenceGrantFor(page, block)
      const answer = await exchange(grant)
      expect(answer.status).toBe(404)
      expect((await answer.json()) as Problem).toMatchObject({ code: 'previewRefused' })
      expect((await exchange(grant, '?site=other')).status).toBe(404)
      // Not spent by it: the draft read still takes it once.
      expect((await rowOf(grant)).usedAt).toBeNull()
      expect((await read(grant, page)).status).toBe(200)
    })

    /** The block's own zone, under the reference: what only a reference grant may populate. */
    const BLOCKS = {
      'populate[sections][on][section.reusable][populate][reusableBlock][populate][blocks]': 'true',
    }

    it("the draft read of a reference grant answers the reusable block's draft with its own blocks populated", async () => {
      const link = (label: string) => ({ label, url: `https://example.com/${label}` })
      const block = await createBlock('Blocks published')
      await publishBlock(block)
      // Another reusable block of the page, published with a link and then edited.
      const other = await createBlock('Other blocks')
      await reusables().update({
        documentId: other,
        locale: 'en',
        data: { blocks: [{ ...cta('Other published'), primaryLink: link('other-published') }] },
      } as never)
      await publishBlock(other)
      const page = await createPage('shows-the-blocks', [reference(block), reference(other)])
      await publishPage(page)
      await reusables().update({
        documentId: block,
        locale: 'en',
        data: { blocks: [{ ...cta('Blocks draft'), primaryLink: link('draft') }] },
      } as never)
      await reusables().update({
        documentId: other,
        locale: 'en',
        data: { blocks: [cta('Other draft')] },
      } as never)
      type Answer = {
        data: { sections: { reusableBlock: { name: string; blocks: unknown[] } | null }[] }
      }
      const answer = await draftOf(await referenceGrantFor(page, block), {
        documentId: page,
        locale: 'en',
        ...BLOCKS,
      })
      expect(answer.status).toBe(200)
      const { data } = (await answer.json()) as Answer
      expect(data.sections[0]!.reusableBlock).toMatchObject({
        name: 'Blocks published',
        blocks: [expect.objectContaining({ __component: 'section.cta', title: 'Blocks draft' })],
      })
      // The rules of a zone of the page itself: `on`, with the fields of a component.
      const fragment = await draftOf(await referenceGrantFor(page, block), {
        documentId: page,
        locale: 'en',
        'populate[sections][on][section.reusable][populate][reusableBlock][populate][blocks][on][section.cta][fields][0]':
          'title',
      })
      expect(fragment.status).toBe(200)
      const blocks = ((await fragment.json()) as Answer).data.sections[0]!.reusableBlock!.blocks
      expect(blocks).toEqual([expect.objectContaining({ title: 'Blocks draft' })])
      // A component inside a block, at any depth; another reusable block stays published.
      const nested = await draftOf(await referenceGrantFor(page, block), {
        documentId: page,
        locale: 'en',
        'populate[sections][on][section.reusable][populate][reusableBlock][populate][blocks][on][section.cta][populate][primaryLink]':
          'true',
      })
      expect(nested.status).toBe(200)
      const sections = ((await nested.json()) as Answer).data.sections
      expect(sections.map((section) => section.reusableBlock!.blocks)).toEqual([
        [
          expect.objectContaining({
            title: 'Blocks draft',
            primaryLink: expect.objectContaining({ label: 'draft' }),
          }),
        ],
        [
          expect.objectContaining({
            title: 'Other published',
            primaryLink: expect.objectContaining({ label: 'other-published' }),
          }),
        ],
      ])
    })

    it("a dynamic zone under a relation stays refused with 400 previewRequestInvalid for an admin grant, a page's own system grant, and a reference grant under any relation but the one to the reusable block", async () => {
      admin = await freshSuperAdmin()
      const block = await createBlock('Zone banner')
      await publishBlock(block)
      const page = await createPage('zone-page', [reference(block)])
      await publishPage(page)
      const post = (
        await strapi.documents('api::post.post' as UID.ContentType).create({
          data: { title: 'A post', site },
        } as never)
      ).documentId
      const query = { documentId: page, locale: 'en', ...BLOCKS }
      const answers = [
        await draftOf(
          await grantFor(admin, { uid: PAGE_UID, documentId: page, locale: 'en' }),
          query
        ),
        await draftOf(
          await systemGrantFor(page, {
            contentType: PAGE_UID,
            entryLocale: 'en',
            entryVersion: await versionOf(page, PAGE_UID, 'en'),
          }),
          query
        ),
        await draftOf(
          await referenceGrantFor(post, block, {
            contentType: 'api::post.post',
            entryLocale: null,
          }),
          { documentId: post, 'populate[related][populate][blocks]': 'true' }
        ),
      ]
      expect(answers.map((answer) => answer.status)).toEqual([400, 400, 400])
      for (const answer of answers) {
        expect((await answer.json()) as Problem).toMatchObject({ code: 'previewRequestInvalid' })
      }
      // The relation to the reusable block, under a reference grant, is the one it serves.
      expect((await draftOf(await referenceGrantFor(page, block), query)).status).toBe(200)
    })

    /** The reference of `section.reusable`, the level of the reusable block in a populate. */
    const BLOCK_LEVEL = 'populate[sections][on][section.reusable][populate][reusableBlock]'

    it('the draft read of a reference grant refuses *, site, localizations and every other attribute of the reusable block but its blocks and fields, with 400 previewRequestInvalid', async () => {
      const block = await createBlock('Narrow banner')
      await publishBlock(block)
      const page = await createPage('narrow-page', [reference(block)])
      await publishPage(page)
      const ask = async (query: Record<string, string>) =>
        draftOf(await referenceGrantFor(page, block), { documentId: page, locale: 'en', ...query })
      const refused: Record<string, string>[] = [
        { [`${BLOCK_LEVEL}[populate]`]: '*' },
        { [`${BLOCK_LEVEL}[populate][site]`]: 'true' },
        { [`${BLOCK_LEVEL}[populate][localizations]`]: 'true' },
        { [`${BLOCK_LEVEL}[populate][name]`]: 'true' },
        { [`${BLOCK_LEVEL}[populate][0]`]: 'blocks', [`${BLOCK_LEVEL}[populate][1]`]: 'site' },
      ]
      const answers = []
      for (const query of refused) answers.push(await ask(query))
      expect(answers.map((answer) => answer.status)).toEqual(Array(refused.length).fill(400))
      for (const answer of answers) {
        expect((await answer.json()) as Problem).toMatchObject({ code: 'previewRequestInvalid' })
      }
      // Its fields and its blocks are what it serves.
      const served = await ask({
        [`${BLOCK_LEVEL}[fields][0]`]: 'name',
        [`${BLOCK_LEVEL}[populate][blocks]`]: 'true',
      })
      expect(served.status).toBe(200)
      const { data } = (await served.json()) as {
        data: { sections: { reusableBlock: Record<string, unknown> }[] }
      }
      expect(data.sections[0]!.reusableBlock).toMatchObject({
        name: 'Narrow banner',
        blocks: [expect.objectContaining({ title: 'Narrow banner' })],
      })
      expect(data.sections[0]!.reusableBlock).not.toHaveProperty('site')
    })

    it("the draft read of a reference grant reads the reusable block's populate within the API token's abilities", async () => {
      const block = await createBlock('Sanitised banner')
      await publishBlock(block)
      const page = await createPage('sanitised-page', [reference(block)])
      await publishPage(page)
      const sanitize = strapi.contentAPI.sanitize as unknown as {
        query: (query: object, schema: { uid?: string }, options: object) => Promise<object>
      }
      const original = sanitize.query.bind(sanitize)
      const seen: { query: object; options: object }[] = []
      // A token that may not read the block's zone: its sanitising drops the populate.
      const spy = vi.spyOn(sanitize, 'query').mockImplementation(async (query, schema, options) => {
        const result = await original(query, schema, options)
        if (schema.uid !== REUSABLE_BLOCK_UID) return result
        seen.push({ query, options })
        return { ...result, populate: {} }
      })
      try {
        const answer = await draftOf(await referenceGrantFor(page, block), {
          documentId: page,
          locale: 'en',
          [`${BLOCK_LEVEL}[populate][blocks]`]: 'true',
        })
        expect(answer.status).toBe(200)
        const { data } = (await answer.json()) as {
          data: { sections: { reusableBlock: Record<string, unknown> }[] }
        }
        expect(data.sections[0]!.reusableBlock).toMatchObject({ name: 'Sanitised banner' })
        expect(data.sections[0]!.reusableBlock).not.toHaveProperty('blocks')
      } finally {
        spy.mockRestore()
      }
      // Sanitised once, with the request's API token and the populate the query asked for.
      expect(seen).toHaveLength(1)
      expect(seen[0]!.query).toMatchObject({ populate: { blocks: true } })
      expect(seen[0]!.options).toMatchObject({ auth: { strategy: expect.anything() } })
    })
  })

  describe('the credential store', () => {
    beforeAll(async () => {
      admin = await freshSuperAdmin()
    })

    it('is hidden from the Content Manager and the Content-Type Builder', async () => {
      const schema = strapi.contentType(PREVIEW_CREDENTIAL_UID as UID.ContentType)
      expect(schema.pluginOptions?.['content-manager']).toEqual({ visible: false })
      expect(schema.pluginOptions?.['content-type-builder']).toEqual({ visible: false })
      const response = await fetch(`${base}/content-manager/content-types`, {
        headers: { Authorization: `Bearer ${adminTokens['strapi-super-admin']}` },
      })
      expect(response.status).toBe(200)
      const { data } = (await response.json()) as { data: { uid: string; isDisplayed: boolean }[] }
      const isDisplayed = (uid: string) => data.find((type) => type.uid === uid)?.isDisplayed
      expect(isDisplayed(ARTICLE_UID)).toBe(true)
      expect(isDisplayed(PREVIEW_CREDENTIAL_UID)).not.toBe(true)
    })

    it('names its site through the required site relation of ADR-0017', async () => {
      const schema = strapi.contentType(PREVIEW_CREDENTIAL_UID as UID.ContentType)
      expect(schema.attributes).toHaveProperty('site', expect.objectContaining({ required: true }))
      await tokenFor(admin)
      const rows = (await credentials().findMany({ populate: ['site'] })) as {
        site: { documentId: string } | null
        siteDocumentId: string
      }[]
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) expect(row.site?.documentId).toBe(row.siteDocumentId)
    })
  })

  describe('rate limits', () => {
    beforeAll(async () => {
      admin = await freshSuperAdmin()
    })

    it('limits the token route per admin user', async () => {
      const reader = await newReader()
      const statuses: number[] = []
      for (let attempt = 0; attempt < 21; attempt += 1) {
        statuses.push((await askToken(reader.token, {})).status)
      }
      expect(statuses.slice(0, 20)).toEqual(Array(20).fill(400))
      expect(statuses[20]).toBe(429)
      const limited = await askToken(reader.token, {})
      expect(limited.headers.get('retry-after')).toMatch(/^\d+$/)
      expect((await limited.json()) as Problem).toMatchObject({ code: 'previewRateLimited' })
      // Another user is not affected.
      expect((await askToken(admin, body())).status).toBe(200)
    })

    it('limits the exchange per API token', async () => {
      const key = (
        (await strapi.service('admin::api-token').create({
          name: 'preview-limit-test',
          type: 'full-access',
          lifespan: null,
        })) as { accessKey: string }
      ).accessKey
      const statuses: number[] = []
      for (let attempt = 0; attempt < 61; attempt += 1) {
        statuses.push((await exchange('unknown', '', key)).status)
      }
      expect(statuses.slice(0, 60)).toEqual(Array(60).fill(404))
      expect(statuses[60]).toBe(429)
      expect((await exchange('unknown')).status).toBe(404)
    })
  })

  describe('logs', () => {
    it('hold no token or grant', async () => {
      const lines: string[] = []
      // vitest replaces `console`, so the capture sits on the transports of Strapi's logger.
      const transports = (strapi.log as unknown as { transports: LogTransport[] }).transports
      const originals = transports.map((transport) => transport.log)
      for (const transport of transports) {
        transport.log = (info, next) => {
          lines.push(`${String(info.message)}${String(info[Symbol.for('message')])}`)
          next()
        }
      }
      const level = strapi.log.level
      strapi.log.level = 'debug'
      const first = issued.length
      try {
        const reader = await newReader()
        const own = await createArticle(admin)
        const value = await tokenFor(reader.token, body(own))
        const grant = await grantFor(reader.token, body(own))
        await exchange(value)
        await exchange('not-a-token')
        await draftOf(grant, { documentId: own })
        await draftOf('not-a-grant', { documentId: own })
        const system = await systemGrantFor(own)
        const served = await draftOf(system, { documentId: own })
        expect(await served.text()).not.toContain(system)
        await exchange(system)
        await askToken(reader.token, { uid: 'admin::user', documentId: 'x' })
      } finally {
        strapi.log.level = level
        transports.forEach((transport, index) => {
          transport.log = originals[index]!
        })
      }
      const log = lines.join('')
      // The run did log requests, so an empty log would prove nothing.
      expect(log).toContain('/micelio/preview/token')
      const secrets = issued.slice(first)
      expect(secrets.length).toBeGreaterThanOrEqual(4)
      for (const secret of secrets) expect(log).not.toContain(secret)
    })
  })
})
