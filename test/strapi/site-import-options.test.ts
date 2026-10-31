import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'
import { exportArchive, rewrite, tar, untar, type ContentFile } from './site-archive'

const LANDING = 'api::landing.landing' as UID.ContentType

// An import validates the options of the blocks like a save does (ADR-0018), and refuses the
// archive before it writes anything, in the dry run too.
describe('the options of the blocks, in an import', () => {
  let strapi: Core.Strapi
  let exported: Map<string, Buffer>

  const service = () => strapi.plugin('micelio').service('siteExport')
  const variant = (columns: string): Buffer => {
    const files = new Map(exported)
    rewrite<ContentFile>(files, 'content/landing.json', (content) => {
      for (const version of content.documents[0]!.versions) {
        const [section] = version.data.sections as { columns?: string; width?: string }[]
        section!.columns = columns
        // The fixture component declares a `width` its block does not expose, so a stored page
        // would carry its default and a save of it would be refused too.
        delete section!.width
      }
      return content
    })
    return tar(new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1))))
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    const site = await strapi.documents(SITE_UID as UID.ContentType).findFirst({
      filters: { slug: 'default' },
    })
    await strapi.documents(LANDING).create({
      locale: 'en',
      data: {
        title: 'Landing',
        sections: [{ __component: 'section.feature-grid', columns: '3' }],
        site: site!.documentId,
      } as never,
    })
    exported = untar(await exportArchive(strapi))
    await strapi.db.query(LANDING).deleteMany({})
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('refuses a value the block does not offer, in the dry run and in the import, and writes nothing', async () => {
    const wrong = variant('6')
    for (const run of [
      () => service().preview(Readable.from([wrong]), { into: 'default' }),
      () => service().import(Readable.from([wrong]), { into: 'default' }),
    ]) {
      await expect(run()).rejects.toMatchObject({
        code: 'exportDocumentInvalid',
        message: expect.stringContaining('feature-grid') as unknown,
      })
    }
    expect(await strapi.db.query(LANDING).count()).toBe(0)
  })

  it('imports the same page with a value the block offers', async () => {
    await service().import(Readable.from([variant('4')]), { into: 'default' })
    expect(await strapi.db.query(LANDING).count()).toBeGreaterThan(0)
  })
})
