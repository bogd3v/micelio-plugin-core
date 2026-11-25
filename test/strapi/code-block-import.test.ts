import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'
import { exportArchive, rewrite, tar, untar, type ContentFile } from './site-archive'

const SNIPPET = 'api::snippet.snippet' as UID.ContentType

// An import checks the highlighted lines of a `code` block like a save does, and refuses the archive
// before it writes anything, in the dry run too.
describe('the highlighted lines of a code block, in an import', () => {
  let strapi: Core.Strapi
  let exported: Map<string, Buffer>

  const service = () => strapi.plugin('micelio').service('siteExport')

  const highlighted = (highlight: unknown): Buffer => {
    const files = new Map(exported)
    rewrite<ContentFile>(files, 'content/snippet.json', (content) => {
      for (const version of content.documents[0]!.versions) {
        version.data.blocks = [{ __component: 'shared.code', code: 'a\nb', highlight }]
      }
      return content
    })
    return tar(new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1))))
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    // The fixture is left out of every archive, which other suites count; this one needs it in.
    const pluginOptions = strapi.contentType(SNIPPET).pluginOptions as {
      micelio: { export: string }
    }
    pluginOptions.micelio.export = 'always'
    const site = await strapi.documents(SITE_UID as UID.ContentType).findFirst({
      filters: { slug: 'default' },
    })
    await strapi.documents(SNIPPET).create({
      data: {
        title: 'A snippet',
        blocks: [{ __component: 'shared.code', code: 'a\nb' }],
        site: site!.documentId,
      } as never,
    })
    exported = untar(await exportArchive(strapi))
    await strapi.db.query(SNIPPET).deleteMany({})
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('refuses a line outside the code, in the dry run and in the import, and writes nothing', async () => {
    const archive = highlighted([1, 3])
    for (const run of [
      () => service().preview(Readable.from([archive]), { into: 'default' }),
      () => service().import(Readable.from([archive]), { into: 'default' }),
    ]) {
      await expect(run()).rejects.toMatchObject({
        code: 'exportDocumentInvalid',
        message: expect.stringContaining('The code block at blocks.0') as unknown,
      })
    }
    expect(await strapi.db.query(SNIPPET).count()).toBe(0)
  })

  it('imports the same block with its lines inside the code', async () => {
    await service().import(Readable.from([highlighted([2, 1])]), { into: 'default' })
    expect(await strapi.db.query(SNIPPET).count()).toBeGreaterThan(0)
  })
})
