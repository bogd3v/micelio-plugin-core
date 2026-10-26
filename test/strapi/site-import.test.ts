import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi } from './harness'
import {
  buildFixtureSite,
  exportArchive,
  GUEST,
  jsonOf,
  LABEL,
  NOTE,
  rewrite,
  STORY,
  tar,
  untar,
  type ContentFile,
  type FixtureSite,
  type Manifest,
} from './site-archive'

const TYPES = [STORY, LABEL, NOTE, GUEST, SITE_UID as UID.ContentType, 'plugin::upload.file']

interface ImportReport {
  site: { documentId: string; slug: string }
  types: Record<string, { created: number; replaced: number; deleted: number; skipped: number }>
  unknownTypes: string[]
  unknownRoles: string[]
  missingReferences: number
  media: { stored: number; reused: number }
}

// The import suite exports the fixture site from one clean Strapi, then imports it into a second
// one, booted on an empty database (acceptance criteria of #30).
describe('the site importer', () => {
  let strapi: Core.Strapi
  let fixture: FixtureSite
  let archive: Buffer
  let exported: Map<string, Buffer>

  function importArchive(body: Buffer, request: object = {}): Promise<ImportReport> {
    return strapi
      .plugin('micelio')
      .service('siteExport')
      .import(Readable.from([body]), request) as Promise<ImportReport>
  }

  /** Every row of the types an import writes, with the time it was last written. */
  async function snapshot(): Promise<unknown[]> {
    const rows: unknown[] = []
    for (const uid of TYPES) {
      const found = (await strapi.db.query(uid as UID.ContentType).findMany({
        select: ['id', 'documentId', 'updatedAt'],
        orderBy: { id: 'asc' },
      })) as unknown[]
      rows.push([uid, found])
    }
    return rows
  }

  /** The archive with some of its files changed, still with a manifest that matches them. */
  function variant(change: (files: Map<string, Buffer>) => void): Buffer {
    const files = new Map(exported)
    change(files)
    return tar(new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1))))
  }

  beforeAll(async () => {
    const source = await setupStrapi()
    fixture = await buildFixtureSite(source)
    archive = await exportArchive(source, { personal: true })
    exported = untar(archive)
    await cleanupStrapi()
    strapi = await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  describe('before it writes anything', () => {
    it('refuses an archive with a locale the target lacks', async () => {
      const before = await snapshot()
      await expect(importArchive(archive, { into: 'default' })).rejects.toMatchObject({
        code: 'exportLocaleMissing',
      })
      expect(await snapshot()).toEqual(before)
      await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' })
    })

    it("refuses an archive whose site's slug another site has", async () => {
      await expect(importArchive(archive)).rejects.toMatchObject({ code: 'exportSiteSlugTaken' })
    })

    it("refuses an archive whose site's host another site has", async () => {
      await strapi.documents(SITE_UID as UID.ContentType).create({
        data: { name: 'Taken', slug: 'taken', hosts: ['taken.test'], modules: {} } as never,
      })
      const taken = variant((files) =>
        rewrite<ContentFile>(files, 'content/site.json', (content) => {
          content.documents[0]!.versions[0]!.data.hosts = ['Taken.test']
          return content
        })
      )
      await expect(importArchive(taken, { into: 'default' })).rejects.toMatchObject({
        code: 'exportHostTaken',
      })
    })

    it.each<[string, (files: Map<string, Buffer>) => Buffer]>([
      [
        'a file that does not match its SHA-256',
        (files) => {
          const body = Buffer.from(files.get('content/note.json')!)
          body[body.length - 2] = 0x20
          files.set('content/note.json', body)
          return tar(files)
        },
      ],
      [
        'a file the manifest does not list',
        (files) => tar(new Map([...files, ['media/extra.json', Buffer.from('{}')]])),
      ],
      [
        'a file the manifest lists and the archive lacks',
        (files) => {
          files.delete('content/label.json')
          return tar(files)
        },
      ],
      ['a symbolic link', (files) => tar(files, { 'content/note.json': '2' })],
      [
        'a path out of the archive',
        (files) => tar(new Map([['../escape.json', Buffer.from('{}')], ...files])),
      ],
    ])('refuses %s with exportArchiveCorrupt', async (_name, build) => {
      const before = await snapshot()
      await expect(
        importArchive(build(new Map(exported)), { into: 'default' })
      ).rejects.toMatchObject({ code: 'exportArchiveCorrupt' })
      expect(await snapshot()).toEqual(before)
    })

    it('refuses a format major it does not know', async () => {
      const newer = variant((files) =>
        rewrite<Manifest>(files, 'manifest.json', (manifest) => ({
          ...manifest,
          formatVersion: '2.0',
        }))
      )
      await expect(importArchive(newer, { into: 'default' })).rejects.toMatchObject({
        code: 'exportFormatUnsupported',
      })
    })

    it('refuses an editorial state that disagrees with the versions', async () => {
      const unpublished = variant((files) =>
        rewrite<ContentFile>(files, 'content/story.json', (content) => {
          const document = content.documents[0]!
          document.versions = document.versions.filter((version) => version.status !== 'published')
          return content
        })
      )
      await expect(importArchive(unpublished, { into: 'default' })).rejects.toMatchObject({
        code: 'exportEditorialInconsistent',
      })
    })

    it('refuses a value that does not fit its attribute', async () => {
      const wrong = variant((files) =>
        rewrite<ContentFile>(files, 'content/story.json', (content) => {
          content.documents[0]!.versions[0]!.data.score = 'three'
          return content
        })
      )
      await expect(importArchive(wrong, { into: 'default' })).rejects.toMatchObject({
        code: 'exportDocumentInvalid',
      })
    })

    it('refuses a media file the target does not allow, and stores none', async () => {
      const security = strapi.config.get('plugin::upload.security')
      strapi.config.set('plugin::upload.security', { deniedTypes: ['image/png'] })
      try {
        await expect(importArchive(archive, { into: 'default' })).rejects.toMatchObject({
          code: 'exportMediaRefused',
        })
        expect(await strapi.db.query('plugin::upload.file').count()).toBe(0)
      } finally {
        strapi.config.set('plugin::upload.security', security)
      }
    })
  })

  describe('into a clean instance', () => {
    let report: ImportReport

    beforeAll(async () => {
      report = await importArchive(archive, { into: 'default' })
    })

    it('reports what it created', () => {
      expect(report.site.slug).toBe('default')
      expect(report.types).toMatchObject({
        guest: { created: 1 },
        label: { created: 1 },
        note: { created: 1 },
        site: { replaced: 1 },
        story: { created: 1 },
      })
      expect(report).toMatchObject({ unknownTypes: [], missingReferences: 0 })
      expect(report.media).toEqual({ stored: 2, reused: 0 })
    })

    it('holds the same documents: a new export gives the same content files', async () => {
      const again = untar(await exportArchive(strapi, { personal: true }))
      for (const name of ['article', 'guest', 'label', 'note', 'story']) {
        expect(jsonOf(again, `content/${name}.json`)).toEqual(
          jsonOf(exported, `content/${name}.json`)
        )
      }
      expect(jsonOf(again, 'media/index.json')).toEqual(jsonOf(exported, 'media/index.json'))
      const site = jsonOf<ContentFile>(again, 'content/site.json').documents[0]!.versions[0]!.data
      const before = jsonOf<ContentFile>(exported, 'content/site.json').documents[0]!.versions[0]!
      expect(site).toEqual(before.data)
    })

    it('answers the same entries on the content API, with the same documentIds', async () => {
      const { port } = strapi.server.httpServer.address() as AddressInfo
      const { accessKey } = (await strapi.service('admin::api-token').create({
        name: 'import-suite',
        type: 'read-only',
        lifespan: null,
      })) as { accessKey: string }
      const response = await fetch(`http://127.0.0.1:${port}/api/notes`, {
        headers: { Authorization: `Bearer ${accessKey}` },
      })
      const body = (await response.json()) as { data: { documentId: string; title: string }[] }
      const note = jsonOf<ContentFile>(exported, 'content/note.json').documents[0]!
      expect(body.data.map(({ documentId, title }) => ({ documentId, title }))).toEqual([
        { documentId: note.documentId, title: 'Mine' },
      ])
    })

    it('publishes the published version and keeps the editorial state, as a restore', async () => {
      const published = (await strapi.documents(STORY).findOne({
        documentId: fixture.story,
        locale: 'en',
        status: 'published',
        populate: ['editorial'],
      } as never)) as unknown as { title: string; editorial: { state: string } }
      expect(published).toMatchObject({
        title: 'Published title',
        editorial: { state: 'published' },
      })
    })

    it('gives the rows of an imported document, in each of its locales, the imported site', async () => {
      const rows = (await strapi.db.query(STORY).findMany({
        where: { documentId: fixture.story },
        populate: ['site'],
      })) as { locale: string; publishedAt: string | null; site: { documentId: string } | null }[]
      expect(new Set(rows.map((row) => row.locale))).toEqual(new Set(['en', 'es']))
      expect(rows.map((row) => row.site?.documentId)).toEqual(
        rows.map(() => report.site.documentId)
      )
    })

    it('writes nothing when the same archive is imported again', async () => {
      const before = await snapshot()
      const second = await importArchive(archive, { into: 'default' })
      expect(await snapshot()).toEqual(before)
      for (const counts of Object.values(second.types)) {
        expect(counts).toMatchObject({ created: 0, replaced: 0, deleted: 0 })
      }
      expect(second.media).toEqual({ stored: 0, reused: 2 })
    })

    it('leaves the documents the archive does not hold in merge, and deletes them in replace', async () => {
      const extra = await strapi.documents(NOTE).create({
        data: { title: 'Only here', site: report.site.documentId } as never,
      })
      expect((await importArchive(archive, { into: 'default' })).types.note).toMatchObject({
        deleted: 0,
      })
      expect(await strapi.documents(NOTE).findOne({ documentId: extra.documentId })).not.toBeNull()
      const replaced = await importArchive(archive, { into: 'default', mode: 'replace' })
      expect(replaced.types.note).toMatchObject({ deleted: 1, skipped: 1 })
      expect(await strapi.documents(NOTE).findOne({ documentId: extra.documentId })).toBeNull()
    })

    it('writes nothing of an archive that fails while it is written', async () => {
      const failing = variant((files) =>
        rewrite<ContentFile>(files, 'content/story.json', (content) => {
          const [document] = content.documents
          // A second story whose published version lacks its required title: Strapi refuses it
          // only when it publishes, after the documents before it are written.
          const copy = JSON.parse(JSON.stringify(document)) as typeof document & object
          copy.documentId = 'storywithouttitle0000000001'
          for (const version of copy.versions) delete version.data.title
          content.documents.push(copy)
          return content
        })
      )
      const before = await snapshot()
      await expect(importArchive(failing, { into: 'default' })).rejects.toThrow()
      expect(await snapshot()).toEqual(before)
    })
  })
})
