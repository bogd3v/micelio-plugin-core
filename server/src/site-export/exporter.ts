// Writes one site as an archive of format 1.0 (`docs/export-format.md`).
import { createHash } from 'node:crypto'
import { Readable, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import type { Core, UID } from '@strapi/strapi'
import packageJson from '../../../package.json'
import { SITE_UID } from '../constants/site'
import { isSiteScoped, SITE_ATTRIBUTE } from '../site-scope'
import {
  CONTENT_FOLDER,
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  MANIFEST_PATH,
  MEDIA_FOLDER,
  MEDIA_INDEX_PATH,
} from './constants'
import { ExportError } from './errors'
import { digestFile, openFile, type LocatedFile } from './media'
import { exportNameOf, exportPolicyOf, isWritten } from './names'
import {
  populateOf,
  serialiseData,
  toTimestamp,
  type Attributes,
  type SerialiseContext,
  type StoredFile,
} from './serialise'
import { tarChunks, type TarFile } from './tar'
import type {
  ContentFile,
  ExportDocument,
  ExportVersion,
  FileDigest,
  Manifest,
  MediaEntry,
  MediaRef,
} from './types'

/** What to export. */
export interface ExportRequest {
  /** The `slug` of the site. */
  site: string
  /** Whether to add the personal data that is not shown on the site. @defaultValue false */
  personal?: boolean
  /** When the export is made; the only value that differs between two exports of a site. */
  now?: Date
}

interface ExportedType {
  uid: string
  name: string
  attributes: Attributes
}

type Row = Record<string, unknown> & { documentId: string; locale?: string | null }

interface SiteRow extends Row {
  slug: string
  theme?: {
    themeId?: string | null
    themeVersion?: string | null
    themeDigest?: string | null
  } | null
}

interface FolderRow {
  path: string
  name: string
}

/**
 * Writes the archive of a site to `output`, gzip-compressed, and answers its manifest.
 *
 * @throws `ExportError` `exportSiteNotFound` when no site has the slug, and
 * `exportMediaUnreadable` when a media file cannot be read. `output` is then left incomplete.
 */
export async function exportSite(
  strapi: Core.Strapi,
  request: ExportRequest,
  output: Writable
): Promise<Manifest> {
  const personal = request.personal ?? false
  const types = exportedTypes(strapi, personal)
  const names = new Map(types.map((type) => [type.uid, type.name]))
  const media = new Map<number, { file: LocatedFile; refs: MediaRef[] }>()
  const context: SerialiseContext = {
    componentAttributes: (uid) =>
      (strapi.components[uid as UID.Component]?.attributes ?? {}) as Attributes,
    exportNameOf: (uid) => names.get(uid),
    mediaRef(file: StoredFile) {
      const ref: MediaRef = { media: '' }
      const entry = media.get(file.id) ?? { file: file as LocatedFile, refs: [] }
      entry.refs.push(ref)
      media.set(file.id, entry)
      return ref
    },
    personal,
  }

  const siteRows = (await strapi.db.query(SITE_UID as UID.ContentType).findMany({
    where: { slug: request.site },
    populate: populateOf(attributesOf(strapi, SITE_UID), context),
  })) as SiteRow[]
  const site = siteRows[0]
  if (!site) throw new ExportError('exportSiteNotFound', `There is no site "${request.site}"`)

  const contents: ContentFile[] = []
  for (const type of types) {
    const rows = type.uid === SITE_UID ? siteRows : await siteRowsOf(strapi, type, site, context)
    contents.push({ type: type.name, documents: documentsOf(strapi, type, rows, context) })
  }

  const index = await mediaIndex(strapi, media)
  const files: TarFile[] = contents.map((content) =>
    jsonFile(`${CONTENT_FOLDER}/${content.type}.json`, content)
  )
  const indexFile = jsonFile(MEDIA_INDEX_PATH, { media: index })
  const digests: Record<string, FileDigest> = {}
  for (const file of [...files, indexFile]) digests[file.path] = digestOf(file.body as Buffer)
  for (const entry of index) {
    digests[`${MEDIA_FOLDER}/${entry.sha256}`] = { sha256: entry.sha256, bytes: entry.bytes }
  }

  const manifest: Manifest = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: (request.now ?? new Date()).toISOString(),
    generator: { name: packageJson.name, version: packageJson.version },
    micelio: packageJson.micelio,
    strapi: String(strapi.config.get('info.strapi') ?? ''),
    site: { documentId: site.documentId, slug: site.slug },
    locales: await localesOf(strapi, contents),
    theme: site.theme?.themeId
      ? {
          id: site.theme.themeId,
          version: site.theme.themeVersion ?? null,
          digest: site.theme.themeDigest ?? null,
        }
      : null,
    // The actor belongs to the fediverse plugin, which this core does not know yet.
    fediverse: null,
    personal,
    types: types.map((type, position) => ({
      name: type.name,
      uid: type.uid,
      file: `${CONTENT_FOLDER}/${type.name}.json`,
      documents: contents[position]?.documents.length ?? 0,
    })),
    media: {
      file: MEDIA_INDEX_PATH,
      count: index.length,
      bytes: index.reduce((sum, entry) => sum + entry.bytes, 0),
    },
    files: Object.fromEntries(Object.entries(digests).sort(([a], [b]) => compare(a, b))),
  }

  const mediaFiles = index.map((entry) => mediaFile(strapi, entry, media))
  const ordered = [...files, jsonFile(MANIFEST_PATH, manifest), indexFile, ...mediaFiles].sort(
    (a, b) => compare(a.path, b.path)
  )
  await pipeline(Readable.from(tarChunks(ordered)), createGzip(), output)
  return manifest
}

/** The site type and every site-scoped type the archive writes, in byte order of export name. */
function exportedTypes(strapi: Core.Strapi, personal: boolean): ExportedType[] {
  const types: ExportedType[] = []
  for (const [uid, schema] of Object.entries(strapi.contentTypes)) {
    if (uid !== SITE_UID && !isSiteScoped(schema)) continue
    if (!isWritten(exportPolicyOf(schema as never), personal)) continue
    types.push({
      uid,
      name: exportNameOf(uid, schema as never),
      attributes: attributesOf(strapi, uid),
    })
  }
  return types.sort((a, b) => compare(a.name, b.name))
}

// Every row of the documents that belong to the site. A document belongs to the site when one of
// its rows does: a row in a locale the site itself lacks can be stored without the relation.
async function siteRowsOf(
  strapi: Core.Strapi,
  type: ExportedType,
  site: SiteRow,
  context: SerialiseContext
): Promise<Row[]> {
  const query = strapi.db.query(type.uid as UID.ContentType)
  const owned = (await query.findMany({
    select: ['documentId'],
    where: { [SITE_ATTRIBUTE]: { documentId: site.documentId } },
  })) as Row[]
  const documentIds = [...new Set(owned.map((row) => row.documentId))]
  if (documentIds.length === 0) return []
  return (await query.findMany({
    where: { documentId: { $in: documentIds } },
    populate: populateOf(type.attributes, context, new Set([SITE_ATTRIBUTE])),
  })) as Row[]
}

function attributesOf(strapi: Core.Strapi, uid: string): Attributes {
  return strapi.contentType(uid as UID.ContentType).attributes as unknown as Attributes
}

function documentsOf(
  strapi: Core.Strapi,
  type: ExportedType,
  rows: Row[],
  context: SerialiseContext
): ExportDocument[] {
  const schema = strapi.contentType(type.uid as UID.ContentType)
  const isLocalized =
    strapi.plugin('i18n')?.service('content-types').isLocalizedContentType(schema) === true
  const hasDrafts = schema.options?.draftAndPublish === true
  const skip = new Set(type.uid === SITE_UID ? [] : [SITE_ATTRIBUTE])
  const documents = new Map<string, ExportVersion[]>()
  for (const row of rows) {
    const version: ExportVersion = {
      locale: isLocalized ? (row.locale ?? null) : null,
      status: hasDrafts && !row.publishedAt ? 'draft' : 'published',
      createdAt: toTimestamp(row.createdAt),
      updatedAt: toTimestamp(row.updatedAt),
      publishedAt: toTimestamp(row.publishedAt),
      data: serialiseData(type.attributes, row, context, skip),
    }
    documents.set(row.documentId, [...(documents.get(row.documentId) ?? []), version])
  }
  return [...documents.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([documentId, versions]) => ({
      documentId,
      versions: versions.sort(
        (a, b) => compare(a.locale ?? '', b.locale ?? '') || compare(a.status, b.status)
      ),
    }))
}

async function mediaIndex(
  strapi: Core.Strapi,
  media: Map<number, { file: LocatedFile; refs: MediaRef[] }>
): Promise<MediaEntry[]> {
  const folders = (await strapi.db.query('plugin::upload.folder').findMany({
    select: ['path', 'name'],
  })) as FolderRow[]
  const folderNames = new Map(folders.map((folder) => [folder.path, folder.name]))
  const entries = new Map<string, MediaEntry>()
  for (const { file, refs } of media.values()) {
    const { sha256, bytes } = await digestFile(strapi, file)
    for (const ref of refs) ref.media = sha256
    if (entries.has(sha256)) continue
    entries.set(sha256, {
      sha256,
      name: String(file.name ?? ''),
      mime: String(file.mime ?? 'application/octet-stream'),
      ext: typeof file.ext === 'string' ? file.ext : null,
      bytes,
      width: typeof file.width === 'number' ? file.width : null,
      height: typeof file.height === 'number' ? file.height : null,
      alternativeText: typeof file.alternativeText === 'string' ? file.alternativeText : null,
      caption: typeof file.caption === 'string' ? file.caption : null,
      folderPath: folderPathOf(String(file.folderPath ?? '/'), folderNames),
    })
  }
  return [...entries.values()].sort((a, b) => compare(a.sha256, b.sha256))
}

// Strapi stores a folder path as ids (`/1/4`); the archive names the folders (`/articles/2026`).
function folderPathOf(stored: string, names: Map<string, string>): string {
  const ids = stored.split('/').filter(Boolean)
  const parts = ids.map(
    (_, position) => names.get(`/${ids.slice(0, position + 1).join('/')}`) ?? ''
  )
  return `/${parts.filter(Boolean).join('/')}`
}

function mediaFile(
  strapi: Core.Strapi,
  entry: MediaEntry,
  media: Map<number, { file: LocatedFile; refs: MediaRef[] }>
): TarFile {
  const source = [...media.values()].find(({ refs }) => refs[0]?.media === entry.sha256)!.file
  return {
    path: `${MEDIA_FOLDER}/${entry.sha256}`,
    bytes: entry.bytes,
    body: verified(strapi, source, entry.sha256),
  }
}

// The file is read a second time to write it: it must still be the file the manifest names.
async function* verified(
  strapi: Core.Strapi,
  file: LocatedFile,
  sha256: string
): AsyncGenerator<Buffer> {
  const hash = createHash('sha256')
  for await (const chunk of await openFile(strapi, file)) {
    hash.update(chunk)
    yield chunk
  }
  if (hash.digest('hex') !== sha256) {
    throw new ExportError(
      'exportMediaUnreadable',
      `Media file ${file.id} changed during the export`
    )
  }
}

async function localesOf(
  strapi: Core.Strapi,
  contents: ContentFile[]
): Promise<Manifest['locales']> {
  const used = new Set<string>()
  for (const content of contents) {
    for (const document of content.documents) {
      for (const version of document.versions) if (version.locale) used.add(version.locale)
    }
  }
  const i18n = strapi.plugin('i18n')
  if (!i18n) return []
  const defaultCode = (await i18n.service('locales').getDefaultLocale()) as string
  const locales = (await i18n.service('locales').find()) as { code: string; name: string }[]
  return locales
    .filter((locale) => used.has(locale.code) || locale.code === defaultCode)
    .map((locale) => ({
      code: locale.code,
      name: locale.name,
      isDefault: locale.code === defaultCode,
    }))
    .sort((a, b) => compare(a.code, b.code))
}

function jsonFile(path: string, value: unknown): TarFile {
  const body = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return { path, bytes: body.length, body }
}

function digestOf(body: Buffer): FileDigest {
  return { sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length }
}

// Byte order of UTF-8, which for the ASCII of the archive is code unit order.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
