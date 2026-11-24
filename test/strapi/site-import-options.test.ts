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

  // The page with one Scene per anchor given (`undefined`: none).
  const anchored = (anchors: (string | undefined)[]): Buffer => {
    const files = new Map(exported)
    rewrite<ContentFile>(files, 'content/landing.json', (content) => {
      for (const version of content.documents[0]!.versions) {
        version.data.sections = anchors.map((anchor) => ({
          __component: 'section.scene',
          variant: 'inline',
          alt: 'A scene',
          anchor,
        }))
      }
      return content
    })
    return tar(new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1))))
  }

  // The page with one `prose` block per body given.
  const prosed = (bodies: string[]): Buffer => {
    const files = new Map(exported)
    rewrite<ContentFile>(files, 'content/landing.json', (content) => {
      for (const version of content.documents[0]!.versions) {
        version.data.sections = bodies.map((body) => ({ __component: 'shared.rich-text', body }))
      }
      return content
    })
    return tar(new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1))))
  }

  // The page with one inline Scene per group key given (`undefined`: none), as `[groupId, tone]`.
  const grouped = (keys: ([string, string] | undefined)[]): Buffer => {
    const files = new Map(exported)
    rewrite<ContentFile>(files, 'content/landing.json', (content) => {
      for (const version of content.documents[0]!.versions) {
        version.data.sections = keys.map((key) => ({
          __component: 'section.scene',
          variant: 'inline',
          alt: 'A scene',
          ...(key ? { group: { groupId: key[0], tone: key[1] } } : {}),
        }))
      }
      return content
    })
    return tar(new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1))))
  }

  // The page with `variants` Scenes, each of the variant named: the archive of a page with islands.
  const scenes = (variants: string[]): Buffer => {
    const files = new Map(exported)
    rewrite<ContentFile>(files, 'content/landing.json', (content) => {
      for (const version of content.documents[0]!.versions) {
        version.data.sections = variants.map((scene) => ({
          __component: 'section.scene',
          variant: scene,
          alt: 'A scene',
        }))
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

  it('refuses a second background Scene, in the dry run and in the import, and writes nothing', async () => {
    const two = scenes(['background', 'background'])
    const before = await strapi.db.query(LANDING).count()
    for (const run of [
      () => service().preview(Readable.from([two]), { into: 'default' }),
      () => service().import(Readable.from([two]), { into: 'default' }),
    ]) {
      await expect(run()).rejects.toMatchObject({
        code: 'exportDocumentInvalid',
        message: expect.stringContaining('2 scene blocks with variant background') as unknown,
      })
    }
    expect(await strapi.db.query(LANDING).count()).toBe(before)
  })

  it('imports a page with one background Scene and any number of inline ones', async () => {
    await service().import(Readable.from([scenes(['background', 'inline', 'inline'])]), {
      into: 'default',
    })
    expect(await strapi.db.query(LANDING).count()).toBeGreaterThan(0)
  })

  it('refuses an anchor that is not kebab-case or is used twice, in the dry run and in the import, and writes nothing', async () => {
    const before = await strapi.db.query(LANDING).count()
    const cases: [Buffer, string][] = [
      [anchored(['intro', 'Not Kebab']), 'sections.1'],
      [anchored(['intro', undefined, 'intro']), 'sections.2'],
    ]
    for (const [archive, position] of cases) {
      for (const run of [
        () => service().preview(Readable.from([archive]), { into: 'default' }),
        () => service().import(Readable.from([archive]), { into: 'default' }),
      ]) {
        await expect(run()).rejects.toMatchObject({
          code: 'exportDocumentInvalid',
          message: expect.stringContaining(`The scene block at ${position}`) as unknown,
        })
      }
    }
    expect(await strapi.db.query(LANDING).count()).toBe(before)
  })

  it('imports a page whose anchors are kebab-case and unique', async () => {
    await service().import(Readable.from([anchored(['intro', 'part-2', undefined])]), {
      into: 'default',
    })
    expect(await strapi.db.query(LANDING).count()).toBeGreaterThan(0)
  })

  it('refuses a prose body whose headings break the rule, in the dry run and in the import, and writes nothing', async () => {
    const before = await strapi.db.query(LANDING).count()
    const cases: [Buffer, string][] = [
      [prosed(['## One', '### Deep\n\n##### Deeper']), 'sections.1'],
      [prosed(['# Title']), 'sections.0'],
    ]
    for (const [archive, position] of cases) {
      for (const run of [
        () => service().preview(Readable.from([archive]), { into: 'default' }),
        () => service().import(Readable.from([archive]), { into: 'default' }),
      ]) {
        await expect(run()).rejects.toMatchObject({
          code: 'exportDocumentInvalid',
          message: expect.stringContaining(`The prose block at ${position}`) as unknown,
        })
      }
    }
    expect(await strapi.db.query(LANDING).count()).toBe(before)
  })

  it('imports a page whose prose bodies open at h2 and keep their levels', async () => {
    await service().import(Readable.from([prosed(['## One\n\n### Two', 'Plain text'])]), {
      into: 'default',
    })
    expect(await strapi.db.query(LANDING).count()).toBeGreaterThan(0)
  })

  it('refuses a group split into two runs or with two tones, in the dry run and in the import, and writes nothing', async () => {
    const before = await strapi.db.query(LANDING).count()
    const cases: [Buffer, string][] = [
      [grouped([['band', 'accent'], undefined, ['band', 'accent']]), 'would be split'],
      [
        grouped([
          ['band', 'raised'],
          ['band', 'accent'],
        ]),
        'sets the tone accent',
      ],
    ]
    for (const [archive, sentence] of cases) {
      for (const run of [
        () => service().preview(Readable.from([archive]), { into: 'default' }),
        () => service().import(Readable.from([archive]), { into: 'default' }),
      ]) {
        await expect(run()).rejects.toMatchObject({
          code: 'exportDocumentInvalid',
          message: expect.stringContaining(sentence) as unknown,
        })
      }
    }
    expect(await strapi.db.query(LANDING).count()).toBe(before)
  })

  it('imports a page whose groups are one run with one tone, a group of one included', async () => {
    const archive = grouped([['band', 'accent'], ['band', 'accent'], undefined, ['solo', 'raised']])
    await service().import(Readable.from([archive]), { into: 'default' })
    expect(await strapi.db.query(LANDING).count()).toBeGreaterThan(0)
  })
})
