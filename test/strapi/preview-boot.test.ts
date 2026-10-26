import { afterAll, describe, expect, it } from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import { PREVIEW_CREDENTIAL_UID } from '../../server/src/constants/preview'
import { SITE_UID } from '../../server/src/constants/site'
import type { PreviewService } from '../../server/src/services/preview'
import { cleanupStrapi, setupStrapi } from './harness'

const ARTICLE_UID = 'api::article.article'
const TABLE = 'micelio_preview_credentials'

describe('the credential store on a boot over rows of the previous release', () => {
  afterAll(async () => {
    await cleanupStrapi()
  })

  const columnsOf = async (strapi: Core.Strapi): Promise<string[]> => {
    const rows = (await strapi.db.connection.raw(`pragma table_info(${TABLE})`)) as {
      name: string
    }[]
    return rows.map((row) => row.name)
  }
  const previews = (strapi: Core.Strapi) =>
    strapi.plugin('micelio').service('preview') as PreviewService
  const tokenOf = (url: string) => new URL(url).searchParams.get('token')!

  it('keeps the tokens and grants working and adds the version column', async () => {
    let strapi = await setupStrapi()
    const site = (await strapi.documents(SITE_UID as UID.ContentType).findFirst({}))!
    await strapi
      .documents(SITE_UID as UID.ContentType)
      .update({ documentId: site.documentId, data: { url: 'https://example.com:8443' } } as never)
    const role = (await strapi.db
      .query('admin::role')
      .findOne({ where: { code: 'strapi-super-admin' } })) as { id: number }
    const user = (await strapi.service('admin::user').create({
      email: 'boot@example.com',
      firstname: 'Boot',
      lastname: 'Test',
      password: 'Password1234',
      roles: [role.id],
      isActive: true,
    })) as { id: number }
    const article = await strapi
      .documents(ARTICLE_UID as UID.ContentType)
      .create({ data: { title: 'A draft', site: site.id } } as never)
    const binding = {
      adminUser: user.id,
      adminOrigin: 'https://admin.example.com',
      siteDocumentId: site.documentId,
      contentType: ARTICLE_UID,
      entryDocumentId: article.documentId,
      entryLocale: null,
    }
    const unused = tokenOf((await previews(strapi).issueToken(binding)).url)
    const exchanged = await previews(strapi).exchange(
      tokenOf((await previews(strapi).issueToken(binding)).url),
      site.documentId
    )
    const grant = exchanged!.grant

    // The database as the previous release left it: the table without the column of the version,
    // and the schema Strapi stored at that boot without it, so the next boot sees a change.
    await strapi.db.connection.schema.alterTable(TABLE, (table) => {
      table.dropColumn('entry_version')
    })
    const stored = (await strapi.db.connection
      .table('strapi_database_schema')
      .orderBy('id', 'desc')
      .first()) as { id: number; schema: string }
    const schema = JSON.parse(stored.schema) as {
      tables: { name: string; columns: { name: string }[] }[]
    }
    const table = schema.tables.find((candidate) => candidate.name === TABLE)!
    table.columns = table.columns.filter((column) => column.name !== 'entry_version')
    await strapi.db.connection
      .table('strapi_database_schema')
      .where({ id: stored.id })
      .update({ schema: JSON.stringify(schema), hash: 'previous-release' })
    expect(await columnsOf(strapi)).not.toContain('entry_version')
    await cleanupStrapi({ keepDatabase: true })

    strapi = await setupStrapi(undefined, { keepDatabase: true })
    expect(await columnsOf(strapi)).toContain('entry_version')
    const rows = (await strapi.db.query(PREVIEW_CREDENTIAL_UID).findMany({})) as {
      kind: string
      entryVersion: string | null
    }[]
    expect(rows.map((row) => row.kind).sort()).toEqual(['grant', 'token', 'token'])
    expect(rows.every((row) => row.entryVersion === null)).toBe(true)

    const expected = { siteDocumentId: site.documentId, entryDocumentId: article.documentId }
    expect(await previews(strapi).resolveGrant(grant, expected)).toMatchObject({
      actor: 'admin',
      entryVersion: null,
      entryDocumentId: article.documentId,
    })
    expect(await previews(strapi).exchange(unused, site.documentId)).toMatchObject({
      adminOrigin: 'https://admin.example.com',
      documentId: article.documentId,
    })
    // A system grant is minted and claimed on the migrated table.
    const system = await previews(strapi).issueSystemGrant({
      siteDocumentId: site.documentId,
      contentType: ARTICLE_UID,
      entryDocumentId: article.documentId,
      entryLocale: null,
      entryVersion: '2026-10-25T12:00:00.000Z',
    })
    expect(await previews(strapi).resolveGrant(system, expected)).toMatchObject({
      actor: 'system',
      entryVersion: '2026-10-25T12:00:00.000Z',
    })
    expect(await previews(strapi).resolveGrant(system, expected)).toBeNull()
  }, 60_000)
})
