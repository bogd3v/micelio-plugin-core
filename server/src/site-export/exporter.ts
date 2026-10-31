// Writes one site as an archive of format 1.0 (`docs/export-format.md`).
import { createHash } from 'node:crypto'
import { Readable, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import type { Core, UID } from '@strapi/strapi'
import packageJson from '../../../package.json'
import { SITE_UID } from '../constants/site'
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
import {
  attributesOf,
  compare,
  documentsOf,
  exportedTypes,
  siteRowsOf,
  type ExportedType,
  type Row,
} from './model'
import { selectSections, writeSections } from './sections'
import { populateOf, type Attributes, type SerialiseContext, type StoredFile } from './serialise'
import { tarChunks, type TarFile } from './tar'
import type {
  ContentFile,
  ExportDocument,
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
  /**
   * The `id` of every section with personal data to include; a section without personal data is
   * always included. The caller who has an admin user checks the section's `permission` first.
   */
  include?: string[]
  /** What the archive holds besides the personal data; each part is on unless it is `false`. */
  scope?: ExportScope
  /** When the export is made; the only value that differs between two exports of a site. */
  now?: Date
}

/**
 * The parts of a site an archive may leave out. An archive without a part stays a valid archive
 * that an importer reads whole: it never holds a reference to what it left out.
 */
export interface ExportScope {
  /** The documents of the site's content types. Off writes the types with no documents. */
  content?: boolean
  /** The media files and the references to them. Off writes no media and no media attribute. */
  media?: boolean
  /** The site's own document beyond its identity: modules, overrides and the theme pin. */
  settings?: boolean
  /** Documents that were never published, with their editorial state. Off keeps published ones. */
  drafts?: boolean
}

/** The attributes of the site document that are its identity: kept when `settings` is off. */
const IDENTITY_ATTRIBUTES = [
  'name',
  'slug',
  'hosts',
  'url',
  'defaultLocale',
  'isDefault',
  'modules',
]

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
  const scope = { content: true, media: true, settings: true, drafts: true, ...request.scope }
  const settings = scope.settings
  const sections = selectSections(strapi, request.include ?? [])
  const types = exportedTypes(strapi, personal)
  const names = new Map(types.map((type) => [type.uid, type.name]))
  const media = new Map<number, { file: LocatedFile; refs: MediaRef[] }>()
  const context: SerialiseContext = {
    componentAttributes: (uid) =>
      (strapi.components[uid as UID.Component]?.attributes ?? {}) as Attributes,
    exportNameOf: (uid) => names.get(uid),
    mediaRef(file: StoredFile) {
      if (!scope.media) return null
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
    contents.push({ type: type.name, documents: await documentsToExport(type) })
  }
  async function documentsToExport(type: ExportedType): Promise<ExportDocument[]> {
    if (type.uid === SITE_UID) return siteDocuments(type)
    if (!scope.content) return []
    const rows = await siteRowsOf(strapi, type, site!, context)
    return documentsOf(type, scope.drafts ? rows : publishedRows(type, rows), context)
  }

  // Without settings the site document keeps its identity; its media is not collected.
  function siteDocuments(type: ExportedType): ExportDocument[] {
    if (settings) return documentsOf(type, siteRows, context)
    const documents = documentsOf(type, siteRows, { ...context, mediaRef: () => null })
    return documents.map((document) => ({
      ...document,
      versions: document.versions.map((version) => ({
        ...version,
        data: Object.fromEntries(
          Object.entries(version.data).filter(([name]) => IDENTITY_ATTRIBUTES.includes(name))
        ),
      })),
    }))
  }

  const index = await mediaIndex(strapi, media)
  const written = await writeSections(strapi, sections, {
    documentId: site.documentId,
    slug: site.slug,
  })
  const files: TarFile[] = [
    ...contents.map((content) => jsonFile(`${CONTENT_FOLDER}/${content.type}.json`, content)),
    ...written.files,
  ]
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
    theme:
      settings && site.theme?.themeId
        ? {
            id: site.theme.themeId,
            version: site.theme.themeVersion ?? null,
            digest: site.theme.themeDigest ?? null,
          }
        : null,
    // The actor belongs to the fediverse plugin, which this core does not know yet.
    fediverse: null,
    personal: personal || written.plugins.some((plugin) => plugin.personalData),
    plugins: written.plugins,
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

// Only the documents that have a published row: what was never published is a draft's content.
function publishedRows(type: ExportedType, rows: Row[]): Row[] {
  if (!type.hasDrafts) return rows
  const published = new Set(rows.filter((row) => row.publishedAt).map((row) => row.documentId))
  return rows.filter((row) => published.has(row.documentId))
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
