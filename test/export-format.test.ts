import fs from 'node:fs'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import { REUSABLE_BLOCK_UID } from '../server/src/constants/reusable-blocks'
import { SITE_UID } from '../server/src/constants/site'
import type { Actor } from '../server/src/editorial/machine'
import type { ImportReport } from '../server/src/site-export/importer'
import type { TransitionsService } from '../server/src/services/transitions'
import { cleanupStrapi, setupStrapi } from './strapi/harness'
import {
  exportArchive,
  jsonOf,
  rewrite,
  tar,
  untar,
  type ContentFile,
  type Manifest,
} from './strapi/site-archive'

// The content types of `micelio-cms` at `v0.4.0` (`git ls-tree v0.4.0` of its `src/api/` and
// `src/plugins/`, and the plugins its `config/plugins.ts` installs), and the `site` type of this
// plugin, and the `category` and `tag` types it took over (the legacy UIDs stay: the `v0.4.0` rows),
// and the `reusable-block` type it added (#200). `docs/export-format.md` must give each one a row: the
// acceptance criterion of #9.
// The log of theme activations (#59) has one too, though it is never written.
const CONTENT_TYPES = [
  'plugin::micelio.site',
  'plugin::micelio.category',
  'plugin::micelio.tag',
  'plugin::micelio.reusable-block',
  'plugin::micelio.theme-activation',
  'api::about.about',
  'api::article.article',
  'api::article-stat.article-stat',
  'api::author.author',
  'api::category.category',
  'api::global.global',
  'api::page.page',
  'api::site-setting.site-setting',
  'api::subscriber.subscriber',
  'api::tag.tag',
  'plugin::fediverse.follower',
  'plugin::fediverse.interaction',
  'plugin::comments.comment',
  'plugin::comments.comment-report',
  'plugin::upload.file',
  'plugin::upload.folder',
  'plugin::i18n.locale',
  'plugin::users-permissions.user',
  'plugin::users-permissions.role',
  'plugin::users-permissions.permission',
]

const DOCUMENT = new URL('../docs/export-format.md', import.meta.url)

/** The UIDs in the first column of the tables of the `Content types` section. */
function documentedTypes(markdown: string): string[] {
  const section = markdown.split(/^## Content types$/m)[1]?.split(/^## /m)[0] ?? ''
  return [...section.matchAll(/^\| `([a-z0-9-]+::[a-z0-9.-]+)` +\|/gm)].map(([, uid]) => uid ?? '')
}

describe('the export format specification', () => {
  const documented = documentedTypes(fs.readFileSync(DOCUMENT, 'utf8'))

  it.each(CONTENT_TYPES)('gives %s its serialisation', (uid) => {
    expect(documented).toContain(uid)
  })

  it('documents each type once', () => {
    expect(new Set(documented).size).toBe(documented.length)
  })
})

// The page fixture (test/strapi/app/src/api/page/) references reusable blocks through `section.reusable`.
const PAGE = 'api::page.page' as UID.ContentType
const REUSABLE = REUSABLE_BLOCK_UID as UID.ContentType

describe('the reusable blocks in the site archive', () => {
  let strapi: Core.Strapi
  let site: string
  let block: string
  let page: string
  let archive: Map<string, Buffer>

  const importArchive = (files: Map<string, Buffer>, request: object = {}) =>
    strapi
      .plugin('micelio')
      .service('siteExport')
      .import(Readable.from([tar(files)]), request) as Promise<ImportReport>

  // The archive without one type, as a release before that type wrote it.
  function without(files: Map<string, Buffer>, name: string): Map<string, Buffer> {
    const copy = new Map(files)
    const path = `content/${name}.json`
    copy.delete(path)
    const manifest = jsonOf<Manifest>(copy, 'manifest.json')
    manifest.types = manifest.types.filter((type) => type.name !== name)
    delete manifest.files[path]
    copy.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)))
    return copy
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    site = (await strapi.documents(SITE_UID as UID.ContentType).findFirst({}))!.documentId
    const role = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    const user = (await strapi.service('admin::user').create({
      email: 'archivist@example.com',
      firstname: 'Archi',
      lastname: 'Vist',
      roles: [role.id],
      isActive: true,
    })) as { id: number }
    const actor: Actor = { kind: 'user', id: user.id, roles: ['strapi-super-admin'] }
    block = (
      await strapi.documents(REUSABLE).create({
        locale: 'en',
        data: {
          name: 'Announcement',
          blocks: [{ __component: 'section.cta', title: 'Join us' }],
          site,
        } as never,
      })
    ).documentId
    const transitions = strapi.plugin('micelio').service('transitions') as TransitionsService
    for (const to of ['in_review', 'published'] as const) {
      await transitions.perform({ uid: REUSABLE, documentId: block, locale: 'en', to, actor })
    }
    page = (
      await strapi.documents(PAGE).create({
        locale: 'en',
        data: {
          title: 'Home',
          slug: 'home',
          sections: [
            { __component: 'shared.rich-text', body: 'Welcome' },
            { __component: 'section.reusable', reusableBlock: block },
          ],
          site,
        } as never,
      })
    ).documentId
    archive = untar(await exportArchive(strapi))
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('the archive carries reusable blocks before pages and resolves references on import', async () => {
    const manifest = jsonOf<Manifest>(archive, 'manifest.json')
    const names = manifest.types.map((type) => type.name)
    expect(names[0]).toBe('reusable-block')
    expect(names.indexOf('reusable-block')).toBeLessThan(names.indexOf('page'))
    expect(manifest.types[0]).toMatchObject({ uid: REUSABLE_BLOCK_UID, documents: 1 })
    const pages = jsonOf<ContentFile>(archive, 'content/page.json').documents
    expect(pages[0]?.versions[0]?.data.sections).toEqual([
      expect.objectContaining({ __component: 'shared.rich-text', body: 'Welcome' }),
      expect.objectContaining({
        __component: 'section.reusable',
        reusableBlock: { ref: 'reusable-block', documentId: block },
      }),
    ])

    // `keep-both` writes the archive's documents under new ids: the copy of the page references
    // the copy of the reusable block, not the original.
    const report = await importArchive(archive, { existing: 'keep-both' })
    expect(report.types['reusable-block']).toMatchObject({ created: 1 })
    expect(report.types.page).toMatchObject({ created: 1 })
    const copies = (await strapi.db.query(PAGE).findMany({
      where: { slug: 'home', documentId: { $ne: page } },
      populate: { sections: { on: { 'section.reusable': { populate: ['reusableBlock'] } } } },
    })) as {
      sections: {
        __component: string
        reusableBlock?: { documentId: string; name: string } | null
      }[]
    }[]
    expect(copies).toHaveLength(1)
    const target = copies[0]!.sections.find(
      (section) => section.__component === 'section.reusable'
    )!.reusableBlock
    expect(target).toMatchObject({ name: 'Announcement' })
    expect(target!.documentId).not.toBe(block)
    const copied = await strapi.documents(REUSABLE).findOne({
      documentId: target!.documentId,
      status: 'published',
      locale: 'en',
    } as never)
    expect(copied).not.toBeNull()
  })

  it('an archive of the previous release imports', async () => {
    // What the release before #200 (format 1.2) wrote for this site: its own `formatVersion`, no
    // `reusable-block` type and no `section.reusable` block, every other block as it is.
    const previous = without(archive, 'reusable-block')
    rewrite<Manifest>(previous, 'manifest.json', (manifest) => ({
      ...manifest,
      formatVersion: '1.2',
    }))
    rewrite<ContentFile>(previous, 'content/page.json', (content) => ({
      ...content,
      documents: content.documents.map((document) => ({
        ...document,
        versions: document.versions.map((version) => ({
          ...version,
          data: {
            ...version.data,
            sections: (version.data.sections as { __component: string }[]).filter(
              (section) => section.__component !== 'section.reusable'
            ),
          },
        })),
      })),
    }))
    expect(jsonOf<Manifest>(previous, 'manifest.json').formatVersion).toBe('1.2')
    const report = await importArchive(previous)
    expect(report.unknownTypes).toEqual([])
    expect(report.types).not.toHaveProperty('reusable-block')
    expect(report.types.page).toMatchObject({ replaced: 1 })
    const imported = (await strapi.documents(PAGE).findOne({
      documentId: page,
      locale: 'en',
      status: 'draft',
      populate: { sections: true },
    } as never)) as { sections: { __component: string; body?: string }[] } | null
    expect(imported?.sections).toEqual([
      expect.objectContaining({ __component: 'shared.rich-text', body: 'Welcome' }),
    ])
    expect(await strapi.documents(REUSABLE).findOne({ documentId: block } as never)).not.toBeNull()
  })

  it("refuses an archive whose page references another site's reusable block", async () => {
    const other = await strapi
      .documents(SITE_UID as UID.ContentType)
      .create({ data: { name: 'Other', slug: 'other', modules: {} } as never })
    const foreign = await strapi.documents(REUSABLE).create({
      locale: 'en',
      data: {
        name: 'Foreign',
        blocks: [{ __component: 'section.cta', title: 'Elsewhere' }],
        site: other.documentId,
      } as never,
    })
    const files = without(archive, 'reusable-block')
    rewrite<ContentFile>(files, 'content/page.json', (content) => ({
      ...content,
      documents: content.documents.map((document) => ({
        ...document,
        versions: document.versions.map((version) => ({
          ...version,
          data: {
            ...version.data,
            sections: [
              {
                __component: 'section.reusable',
                reusableBlock: { ref: 'reusable-block', documentId: foreign.documentId },
              },
            ],
          },
        })),
      })),
    }))
    await expect(importArchive(files)).rejects.toMatchObject({
      code: 'exportDocumentInvalid',
      message: expect.stringContaining('belongs to another site') as unknown,
    })
  })
})
