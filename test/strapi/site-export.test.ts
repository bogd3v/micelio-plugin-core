import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import { gunzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi, testEnvironment } from './harness'

// The fixture types of test/strapi/app/src/api/: `story` (localised, editorial, with media, blocks,
// a private, a password and a personal attribute), `label` (the inverse side of `story.labels`),
// `guest` (personal as a whole) and `note`.
const STORY = 'api::story.story' as UID.ContentType
const LABEL = 'api::label.label' as UID.ContentType
const GUEST = 'api::guest.guest' as UID.ContentType
const NOTE = 'api::note.note' as UID.ContentType
const NOW = new Date('2026-10-23T12:00:00.000Z')
const ADMIN_EMAIL = 'exporter@example.com'
// A 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

interface Manifest {
  format: string
  formatVersion: string
  exportedAt: string
  micelio: string
  site: { documentId: string; slug: string }
  locales: { code: string; isDefault: boolean }[]
  personal: boolean
  types: { name: string; uid: string; file: string; documents: number }[]
  media: { count: number; bytes: number }
  files: Record<string, { sha256: string; bytes: number }>
}

interface Version {
  locale: string | null
  status: string
  publishedAt: string | null
  data: Record<string, unknown>
}

interface ContentFile {
  type: string
  documents: { documentId: string; versions: Version[] }[]
}

/** The files of a gzip-compressed ustar archive, in their order. */
function untar(archive: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(archive)
  const files = new Map<string, Buffer>()
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '')
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii'), 8)
    expect(header.subarray(156, 157).toString('ascii')).toBe('0')
    files.set(name, tar.subarray(offset + 512, offset + 512 + size))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex')
}

describe('the site exporter', () => {
  let strapi: Core.Strapi
  let site: string
  let story: string
  let adminId: number
  let pngSha: string
  let stored: Buffer

  async function exportArchive(request: object): Promise<Buffer> {
    const chunks: Buffer[] = []
    const output = new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk)
        done()
      },
    })
    await strapi
      .plugin('micelio')
      .service('siteExport')
      .export({ site: 'default', now: NOW, ...request }, output)
    return Buffer.concat(chunks)
  }

  function contentOf(files: Map<string, Buffer>, name: string): ContentFile {
    return JSON.parse(files.get(`content/${name}.json`)!.toString('utf8')) as ContentFile
  }

  async function upload(name: string): Promise<number> {
    const filepath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'micelio-export-')), name)
    fs.writeFileSync(filepath, PNG)
    const [file] = (await strapi
      .plugin('upload')
      .service('upload')
      .upload({
        data: { fileInfo: { name, alternativeText: `Alt of ${name}` } },
        files: { filepath, originalFilename: name, mimetype: 'image/png', size: PNG.length },
      })) as { id: number }[]
    return file!.id
  }

  function move(documentId: string, to: string, locale = 'en'): Promise<unknown> {
    return strapi
      .plugin('micelio')
      .service('transitions')
      .perform({
        uid: STORY,
        documentId,
        locale,
        to,
        actor: { kind: 'user', id: adminId, roles: ['strapi-super-admin'] },
      })
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    site = (await strapi.documents(SITE_UID as UID.ContentType).findFirst({}))!.documentId
    const other = await strapi
      .documents(SITE_UID as UID.ContentType)
      .create({ data: { name: 'Other', slug: 'other', modules: {} } as never })
    await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' })
    const role = (await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number }
    adminId = (
      (await strapi.service('admin::user').create({
        email: ADMIN_EMAIL,
        firstname: 'Exporter',
        lastname: 'Test',
        password: 'Password1234',
        roles: [role.id],
        isActive: true,
      })) as { id: number }
    ).id
    await strapi.service('admin::api-token').create({
      name: 'export-suite',
      type: 'read-only',
      lifespan: null,
    })

    const cover = await upload('cover.png')
    const again = await upload('again.png')
    // Strapi rewrites an image on upload: the archive holds the file the library stores.
    const { url } = (await strapi.db.query('plugin::upload.file').findOne({
      where: { id: cover },
    })) as { url: string }
    stored = fs.readFileSync(path.join(strapi.dirs.static.public, url))
    pngSha = sha256(stored)

    const label = await strapi
      .documents(LABEL)
      .create({ data: { name: 'Label', site } as never, locale: 'en' })
    await strapi
      .documents(LABEL)
      .update({ documentId: label.documentId, locale: 'es', data: { name: 'Etiqueta' } as never })

    const created = await strapi.documents(STORY).create({
      locale: 'en',
      data: {
        title: 'Published title',
        body: '# Heading',
        day: '2026-10-01',
        score: 3,
        cover,
        gallery: [again, cover],
        labels: [label.documentId],
        owner: adminId,
        links: [{ label: 'Home', url: 'https://example.com/' }],
        blocks: [
          { __component: 'shared.quote', title: 'Said', body: 'Something' },
          { __component: 'fixture.link', label: 'More', url: 'https://example.com/more' },
        ],
        notes: 'secret value',
        pin: 'pin value',
        contact: 'reader@example.com',
        site,
      } as never,
    })
    story = created.documentId
    await move(story, 'in_review')
    await move(story, 'published')
    await strapi
      .documents(STORY)
      .update({ documentId: story, locale: 'en', data: { title: 'Draft title' } as never })
    await strapi
      .documents(STORY)
      .update({ documentId: story, locale: 'es', data: { title: 'Título' } as never })

    await strapi.documents(GUEST).create({ data: { email: 'guest@example.com', site } as never })
    await strapi.documents(NOTE).create({ data: { title: 'Mine', site } as never })
    await strapi
      .documents(NOTE)
      .create({ data: { title: 'Not mine', site: other.documentId } as never })
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  describe('an archive without personal data', () => {
    let archive: Buffer
    let files: Map<string, Buffer>
    let manifest: Manifest

    beforeAll(async () => {
      archive = await exportArchive({})
      files = untar(archive)
      manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')) as Manifest
    })

    it('lists every file but the manifest, with its size and SHA-256, in byte order', () => {
      const paths = [...files.keys()]
      expect(paths).toEqual([...paths].sort())
      expect(Object.keys(manifest.files)).toEqual(paths.filter((name) => name !== 'manifest.json'))
      for (const [name, digest] of Object.entries(manifest.files)) {
        expect(digest).toEqual({ sha256: sha256(files.get(name)!), bytes: files.get(name)!.length })
      }
    })

    it('describes the format, the site and the locales', () => {
      expect(manifest).toMatchObject({
        format: 'micelio-site-export',
        formatVersion: '1.0',
        exportedAt: NOW.toISOString(),
        micelio: expect.stringMatching(/^\d+\.\d+$/) as unknown,
        site: { documentId: site, slug: 'default' },
        personal: false,
        media: { count: 1, bytes: stored.length },
      })
      expect(manifest.locales).toEqual([
        { code: 'en', name: 'English (en)', isDefault: true },
        { code: 'es', name: 'Spanish (es)', isDefault: false },
      ])
    })

    it('writes the site and every site-scoped type but the personal one, by export name', () => {
      expect(manifest.types.map(({ name, uid, documents }) => [name, uid, documents])).toEqual([
        ['article', 'api::article.article', 0],
        ['essay', 'api::essay.essay', 0],
        ['label', LABEL, 1],
        ['note', NOTE, 1],
        ['site', SITE_UID, 1],
        ['story', STORY, 1],
      ])
    })

    it("holds only the site's own documents", () => {
      const notes = contentOf(files, 'note').documents
      expect(notes.map((note) => note.versions[0]?.data.title)).toEqual(['Mine'])
      expect(notes[0]?.versions[0]?.data).not.toHaveProperty('site')
    })

    it('writes each locale and status of a document, draft before published', () => {
      const [document] = contentOf(files, 'story').documents
      expect(document?.documentId).toBe(story)
      expect(
        document?.versions.map(({ locale, status, data }) => [locale, status, data.title])
      ).toEqual([
        ['en', 'draft', 'Draft title'],
        ['en', 'published', 'Published title'],
        ['es', 'draft', 'Título'],
      ])
      const published = document?.versions[1]
      expect(published?.publishedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
    })

    it('serialises each kind of attribute by the rules of the format', () => {
      const published = contentOf(files, 'story').documents[0]!.versions[1]!.data
      const label = contentOf(files, 'label').documents[0]!
      expect(published).toMatchObject({
        body: '# Heading',
        day: '2026-10-01',
        score: 3,
        cover: { media: pngSha },
        gallery: [{ media: pngSha }, { media: pngSha }],
        labels: [{ ref: 'label', documentId: label.documentId }],
        owner: null,
        links: [{ label: 'Home', url: 'https://example.com/' }],
        blocks: [
          { __component: 'shared.quote', block: 'quote', title: 'Said', body: 'Something' },
          { __component: 'fixture.link', label: 'More', url: 'https://example.com/more' },
        ],
        editorial: { state: 'published', publishAt: null, reviewedBy: null, publishedBy: null },
      })
      expect(published.blocks).not.toContainEqual(
        expect.objectContaining({ id: expect.anything() })
      )
      expect(Object.keys(published)).not.toEqual(
        expect.arrayContaining(['notes', 'pin', 'contact'])
      )
      expect(label.versions[0]?.data).not.toHaveProperty('stories')
    })

    it('writes a media file once, as the library stores it, with its index entry', () => {
      expect(sha256(files.get(`media/sha256/${pngSha}`)!)).toBe(pngSha)
      const { media } = JSON.parse(files.get('media/index.json')!.toString('utf8')) as {
        media: Record<string, unknown>[]
      }
      expect(media).toEqual([
        expect.objectContaining({
          sha256: pngSha,
          mime: 'image/png',
          bytes: stored.length,
          folderPath: '/',
        }),
      ])
      expect(media[0]).not.toHaveProperty('url')
    })

    it('holds no password, token, key, admin user or personal value', () => {
      const text = gunzipSync(archive).toString('utf8')
      for (const value of [
        ADMIN_EMAIL,
        'secret value',
        'pin value',
        'reader@example.com',
        'guest@example.com',
        testEnvironment().ENCRYPTION_KEY,
        testEnvironment().API_TOKEN_SALT,
        'accessKey',
        'password',
      ]) {
        expect(text).not.toContain(value)
      }
    })

    it('is the same archive when the site has not changed', async () => {
      expect((await exportArchive({})).equals(archive)).toBe(true)
    })
  })

  describe('an archive with personal data', () => {
    let files: Map<string, Buffer>

    beforeAll(async () => {
      files = untar(await exportArchive({ personal: true }))
    })

    it('adds the personal types and attributes', () => {
      const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')) as Manifest
      expect(manifest.personal).toBe(true)
      expect(manifest.types.map((type) => type.name)).toContain('guest')
      expect(contentOf(files, 'guest').documents[0]?.versions[0]?.data).toEqual({
        email: 'guest@example.com',
      })
      expect(contentOf(files, 'story').documents[0]?.versions[0]?.data.contact).toBe(
        'reader@example.com'
      )
    })

    it('still holds no private attribute, password or admin user', () => {
      const text = [...files.values()].map((body) => body.toString('utf8')).join('\n')
      for (const value of [ADMIN_EMAIL, 'secret value', 'pin value']) {
        expect(text).not.toContain(value)
      }
    })
  })

  it('refuses a site that does not exist with exportSiteNotFound', async () => {
    await expect(exportArchive({ site: 'missing' })).rejects.toMatchObject({
      code: 'exportSiteNotFound',
    })
  })
})
