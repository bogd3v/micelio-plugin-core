import { gunzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Core } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { cleanupStrapi, setupStrapi, testEnvironment } from './harness'
import {
  ADMIN_EMAIL,
  buildFixtureSite,
  exportArchive as exportFrom,
  LABEL,
  NOTE,
  NOW,
  sha256,
  STORY,
  untar,
  type ContentFile,
  type Manifest,
} from './site-archive'

describe('the site exporter', () => {
  let strapi: Core.Strapi
  let site: string
  let story: string
  let pngSha: string
  let redSha: string
  let stored: Buffer

  const exportArchive = (request: object): Promise<Buffer> => exportFrom(strapi, request)

  function contentOf(files: Map<string, Buffer>, name: string): ContentFile {
    return JSON.parse(files.get(`content/${name}.json`)!.toString('utf8')) as ContentFile
  }

  beforeAll(async () => {
    strapi = await setupStrapi()
    ;({ site, story, pngSha, redSha, stored } = await buildFixtureSite(strapi))
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
        formatVersion: '1.1',
        exportedAt: NOW.toISOString(),
        micelio: expect.stringMatching(/^\d+\.\d+$/) as unknown,
        site: { documentId: site, slug: 'default' },
        personal: false,
        media: { count: 2 },
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
        gallery: [{ media: redSha }, { media: pngSha }],
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
      // The cover is in two attributes and written once.
      expect(media).toHaveLength(2)
      expect(media).toContainEqual(
        expect.objectContaining({
          sha256: pngSha,
          mime: 'image/png',
          bytes: stored.length,
          folderPath: '/',
        })
      )
      for (const entry of media) expect(entry).not.toHaveProperty('url')
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
