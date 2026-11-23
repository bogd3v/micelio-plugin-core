import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'
import { exportArchive, rewrite, tar, untar, type ContentFile } from './site-archive'

const WALL = 'api::review-wall.review-wall' as UID.ContentType

// An import checks the rating of a testimonial like a save does, and refuses the archive before it
// writes anything, in the dry run too.
describe('the rating of a testimonial, in an import', () => {
  let strapi: Core.Strapi
  let exported: Map<string, Buffer>

  const service = () => strapi.plugin('micelio').service('siteExport')

  // The archive of a page whose one testimonial has the rating given.
  const rated = (rating: unknown): Buffer => {
    const files = new Map(exported)
    rewrite<ContentFile>(files, 'content/review-wall.json', (content) => {
      for (const version of content.documents[0]!.versions) {
        version.data.sections = [
          {
            __component: 'section.testimonials',
            items: [{ quote: 'It works', author: 'Ana', rating }],
          },
        ]
      }
      return content
    })
    return tar(new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1))))
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    // The fixture is left out of every archive, which other suites count; this one needs it in.
    const pluginOptions = strapi.contentType(WALL).pluginOptions as { micelio: { export: string } }
    pluginOptions.micelio.export = 'always'
    const site = await strapi.documents(SITE_UID as UID.ContentType).findFirst({
      filters: { slug: 'default' },
    })
    await strapi.documents(WALL).create({
      data: {
        title: 'A wall',
        sections: [{ __component: 'section.testimonials', items: [{ quote: 'q', author: 'a' }] }],
        site: site!.documentId,
      } as never,
    })
    exported = untar(await exportArchive(strapi))
    await strapi.db.query(WALL).deleteMany({})
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('refuses a rating outside 1 to 5, in the dry run and in the import, and writes nothing', async () => {
    for (const rating of [0, 6]) {
      const archive = rated(rating)
      for (const run of [
        () => service().preview(Readable.from([archive]), { into: 'default' }),
        () => service().import(Readable.from([archive]), { into: 'default' }),
      ]) {
        await expect(run()).rejects.toMatchObject({
          code: 'exportDocumentInvalid',
          message: expect.stringContaining('The testimonials block at sections.0') as unknown,
        })
      }
    }
    expect(await strapi.db.query(WALL).count()).toBe(0)
  })

  it('imports the same page with a rating from 1 to 5', async () => {
    await service().import(Readable.from([rated(5)]), { into: 'default' })
    expect(await strapi.db.query(WALL).count()).toBeGreaterThan(0)
  })
})
