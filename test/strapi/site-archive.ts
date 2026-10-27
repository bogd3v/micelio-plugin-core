// What the export and import suites share: the fixture site they export, and reading and writing
// the files of an archive.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { Writable } from 'node:stream'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../../server/src/constants/site'
import { startWeightSite } from './weight-site'

// The fixture types of test/strapi/app/src/api/: `story` (localised, editorial, with media, blocks,
// a private, a password and a personal attribute), `label` (the inverse side of `story.labels`),
// `guest` (personal as a whole) and `note`.
export const STORY = 'api::story.story' as UID.ContentType
export const LABEL = 'api::label.label' as UID.ContentType
export const GUEST = 'api::guest.guest' as UID.ContentType
export const NOTE = 'api::note.note' as UID.ContentType
export const NOW = new Date('2026-10-23T12:00:00.000Z')
export const ADMIN_EMAIL = 'exporter@example.com'
// A 1x1 transparent PNG, and a 2x1 red one.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4z8DwH4QBEfcD/RSF9bkAAAAASUVORK5CYII=',
  'base64'
)
const BLOCK = 512

export interface Manifest {
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

export interface Version {
  locale: string | null
  status: string
  publishedAt: string | null
  data: Record<string, unknown>
}

export interface ContentFile {
  type: string
  documents: { documentId: string; versions: Version[] }[]
}

/** What the fixture site holds, for the assertions. */
export interface FixtureSite {
  site: string
  story: string
  label: string
  adminId: number
  /** The bytes of the cover image as the library stores them, and their SHA-256. */
  stored: Buffer
  pngSha: string
  /** The SHA-256 of the other image, which only the gallery holds. */
  redSha: string
}

/** The files of a gzip-compressed ustar archive, in their order. */
export function untar(archive: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(archive)
  const files = new Map<string, Buffer>()
  for (let offset = 0; offset + BLOCK <= tar.length;) {
    const header = tar.subarray(offset, offset + BLOCK)
    if (header.every((byte) => byte === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '')
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii'), 8)
    if (header.subarray(156, 157).toString('ascii') !== '0')
      throw new Error(`${name} is not a file`)
    files.set(name, tar.subarray(offset + BLOCK, offset + BLOCK + size))
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK
  }
  return files
}

/**
 * A gzip-compressed ustar archive of `files`, in their order, with `flag` as the type of the
 * entries it names (`2` for a symbolic link): for archives an exporter would never write.
 */
export function tar(files: Map<string, Buffer>, flags: Record<string, string> = {}): Buffer {
  const blocks: Buffer[] = []
  for (const [name, body] of files) {
    const header = Buffer.alloc(BLOCK)
    header.write(name, 0, 'utf8')
    header.write('0000644\0', 100, 'ascii')
    header.write('0000000\0', 108, 'ascii')
    header.write('0000000\0', 116, 'ascii')
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 'ascii')
    header.write('00000000000\0', 136, 'ascii')
    header.write('        ', 148, 'ascii')
    header.write(flags[name] ?? '0', 156, 'ascii')
    header.write('ustar\0', 257, 'ascii')
    header.write('00', 263, 'ascii')
    let sum = 0
    for (const byte of header) sum += byte
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
    blocks.push(header, body, Buffer.alloc((BLOCK - (body.length % BLOCK)) % BLOCK))
  }
  blocks.push(Buffer.alloc(BLOCK * 2))
  return gzipSync(Buffer.concat(blocks))
}

/** The SHA-256 of some bytes, in lower case hex. */
export function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex')
}

/** A JSON file of an archive, parsed. */
export function jsonOf<T>(files: Map<string, Buffer>, name: string): T {
  return JSON.parse(files.get(name)!.toString('utf8')) as T
}

/**
 * Changes a JSON file of an archive and writes its new size and SHA-256 in the manifest, so that
 * the archive is still whole: for archives whose content, not whose integrity, is wrong.
 */
export function rewrite<T>(
  files: Map<string, Buffer>,
  name: string,
  change: (value: T) => T
): void {
  const body = Buffer.from(`${JSON.stringify(change(jsonOf<T>(files, name)), null, 2)}\n`)
  files.set(name, body)
  if (name === 'manifest.json') return
  const manifest = jsonOf<Manifest>(files, 'manifest.json')
  manifest.files[name] = { sha256: sha256(body), bytes: body.length }
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)))
}

/** Exports the site `default`, or the one the request names, into memory. */
export async function exportArchive(strapi: Core.Strapi, request: object = {}): Promise<Buffer> {
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

/**
 * Runs `work` with a frontend that measures every page as light, because a story has blocks and
 * publishing it asks the site's frontend for its weight (the budget). The site's `url` is put
 * back afterwards, so the archive holds what it always held.
 */
async function withFrontend(strapi: Core.Strapi, site: string, work: () => Promise<void>) {
  const { port } = strapi.server.httpServer.address() as AddressInfo
  const token = (await strapi.service('admin::api-token').create({
    name: 'export-suite-frontend',
    type: 'full-access',
    lifespan: null,
  })) as { id: number; accessKey: string }
  const slug = (await strapi.documents(SITE_UID as UID.ContentType).findOne({ documentId: site }))!
    .slug as string
  const frontend = await startWeightSite({
    base: `http://127.0.0.1:${port}`,
    apiToken: token.accessKey,
    siteSlug: slug,
  })
  const sites = strapi.documents(SITE_UID as UID.ContentType)
  const before = (await sites.findOne({ documentId: site }))!.url ?? null
  await sites.update({ documentId: site, data: { url: frontend.origin } as never })
  try {
    await work()
  } finally {
    await sites.update({ documentId: site, data: { url: before } as never })
    await frontend.close()
    await strapi.service('admin::api-token').revoke(token.id)
  }
}

/**
 * Fills the default site with one document of each fixture type, in two locales, with media,
 * and adds a second site with a note of its own.
 */
export async function buildFixtureSite(strapi: Core.Strapi): Promise<FixtureSite> {
  const site = (await strapi.documents(SITE_UID as UID.ContentType).findFirst({}))!.documentId
  const other = await strapi
    .documents(SITE_UID as UID.ContentType)
    .create({ data: { name: 'Other', slug: 'other', modules: {} } as never })
  await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' })
  const role = (await strapi.db.query('admin::role').findOne({
    where: { code: 'strapi-super-admin' },
  })) as { id: number }
  const adminId = (
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

  const cover = await upload(strapi, 'cover.png', PNG)
  const red = await upload(strapi, 'red.png', RED_PNG)
  // Strapi rewrites an image on upload: the archive holds the file the library stores.
  const { url } = (await strapi.db.query('plugin::upload.file').findOne({
    where: { id: cover },
  })) as { url: string }
  const stored = fs.readFileSync(path.join(strapi.dirs.static.public, url))
  const { url: redUrl } = (await strapi.db.query('plugin::upload.file').findOne({
    where: { id: red },
  })) as { url: string }
  const redSha = sha256(fs.readFileSync(path.join(strapi.dirs.static.public, redUrl)))

  const label = await strapi
    .documents(LABEL)
    .create({ data: { name: 'Label', site } as never, locale: 'en' })
  // The other locale without `site`: it is not localised, and the site has no `es` version.
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
      gallery: [red, cover],
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
  const story = created.documentId
  await withFrontend(strapi, site, async () => {
    for (const to of ['in_review', 'published']) {
      await strapi
        .plugin('micelio')
        .service('transitions')
        .perform({
          uid: STORY,
          documentId: story,
          locale: 'en',
          to,
          actor: { kind: 'user', id: adminId, roles: ['strapi-super-admin'] },
        })
    }
  })
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
  return { site, story, label: label.documentId, adminId, stored, pngSha: sha256(stored), redSha }
}

async function upload(strapi: Core.Strapi, name: string, bytes: Buffer): Promise<number> {
  const filepath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'micelio-export-')), name)
  fs.writeFileSync(filepath, bytes)
  const [file] = (await strapi
    .plugin('upload')
    .service('upload')
    .upload({
      data: { fileInfo: { name, alternativeText: `Alt of ${name}` } },
      files: { filepath, originalFilename: name, mimetype: 'image/png', size: bytes.length },
    })) as { id: number }[]
  return file!.id
}
