// Stores the media of an archive in the target's library, or finds it there already
// (`docs/export-format.md`, "Media").
import { createReadStream, statSync } from 'node:fs'
import type { Core } from '@strapi/strapi'
import { ExportError } from './errors'
import { digestFile, type LocatedFile } from './media'
import type { MediaEntry } from './types'

/** What storing the media did. */
export interface StoredMedia {
  /** The target's file for each digest of the archive. */
  files: Map<string, number>
  /** The files this import added, which a failed import removes. */
  uploaded: number[]
  reused: number
}

interface UploadSecurity {
  allowedTypes?: string[]
  deniedTypes?: string[]
}

type FileData = Record<string, unknown> & { getStream(): NodeJS.ReadableStream; filepath?: string }

interface ImageManipulation {
  isImage(file: FileData): Promise<boolean>
  isResizableImage(file: FileData): Promise<boolean>
  getDimensions(file: FileData): Promise<{ width?: number; height?: number }>
  generateThumbnail(file: FileData): Promise<FileData | null>
  generateResponsiveFormats(file: FileData): Promise<({ key: string; file: FileData } | null)[]>
}

const FILE_ATTRIBUTES = [
  'name',
  'alternativeText',
  'caption',
  'width',
  'height',
  'formats',
  'hash',
  'ext',
  'mime',
  'size',
  'url',
  'previewUrl',
  'provider',
  'provider_metadata',
  'folder',
  'folderPath',
]

/**
 * Finds or stores every media file of an archive.
 *
 * @remarks
 * A file whose name, type and SHA-256 the library already holds is reused. Any other is checked
 * against the target's upload rules (`security.deniedTypes` and `allowedTypes` on the type the
 * archive declares, which is the type it is served with, and `sizeLimit`) and stored as it is:
 * Strapi's optimisation of an uploaded image is not applied, so the digest survives a second
 * export. The thumbnail and the responsive formats are made by the target, as for an upload.
 *
 * @throws `ExportError` `exportMediaRefused` when the target refuses a file; the files stored
 * before it are removed.
 */
export async function storeMedia(
  strapi: Core.Strapi,
  media: MediaEntry[],
  staged: Map<string, string>
): Promise<StoredMedia> {
  const result: StoredMedia = { files: new Map(), uploaded: [], reused: 0 }
  try {
    for (const entry of media) {
      const existing = await findStored(strapi, entry)
      if (existing !== undefined) {
        result.files.set(entry.sha256, existing)
        result.reused += 1
        continue
      }
      const id = await store(strapi, entry, staged.get(entry.sha256)!)
      result.files.set(entry.sha256, id)
      result.uploaded.push(id)
    }
  } catch (error) {
    await removeMedia(strapi, result.uploaded)
    throw error
  }
  return result
}

/** Removes files an import stored, when the import fails after storing them. */
export async function removeMedia(strapi: Core.Strapi, ids: number[]): Promise<void> {
  const upload = strapi.plugin('upload').service('upload')
  for (const id of ids) {
    const file = await upload.findOne(id)
    if (file) await upload.remove(file)
  }
}

async function findStored(strapi: Core.Strapi, entry: MediaEntry): Promise<number | undefined> {
  const candidates = (await strapi.db.query('plugin::upload.file').findMany({
    where: { name: entry.name, mime: entry.mime },
  })) as LocatedFile[]
  for (const candidate of candidates) {
    try {
      if ((await digestFile(strapi, candidate)).sha256 === entry.sha256) return candidate.id
    } catch {
      // A library file that cannot be read is not the one the archive holds; another is stored.
    }
  }
  return undefined
}

async function store(strapi: Core.Strapi, entry: MediaEntry, filepath: string): Promise<number> {
  const security = (strapi.config.get('plugin::upload.security') ?? {}) as UploadSecurity
  if (!isAllowed(entry.mime, security))
    throw refused(entry, `the type ${entry.mime} is not allowed`)
  const upload = strapi.plugin('upload')
  const folder = await folderOf(strapi, entry.folderPath)
  const info = (await upload
    .service('upload')
    .formatFileInfo(
      { filename: `${entry.name}`, type: entry.mime, size: statSync(filepath).size },
      { name: entry.name, alternativeText: entry.alternativeText, caption: entry.caption, folder },
      {}
    )) as Record<string, unknown>
  const fileData: FileData = {
    ...info,
    filepath,
    getStream: () => createReadStream(filepath),
  }
  const provider = upload.service('provider')
  try {
    await provider.checkFileSize(fileData)
  } catch (error) {
    throw refused(entry, error instanceof Error ? error.message : 'it is too large')
  }
  const images = upload.service('image-manipulation') as ImageManipulation
  const derived: [string, FileData][] = []
  if (await images.isImage(fileData)) {
    Object.assign(fileData, await images.getDimensions(fileData))
    if (await images.isResizableImage(fileData)) {
      const thumbnail = await images.generateThumbnail(fileData)
      if (thumbnail) derived.push(['thumbnail', thumbnail])
      for (const format of await images.generateResponsiveFormats(fileData)) {
        if (format) derived.push([format.key, format.file])
      }
    }
  }
  await provider.upload(fileData)
  const formats: Record<string, unknown> = {}
  for (const [key, file] of derived) {
    await provider.upload(file)
    formats[key] = withoutStreams(file)
  }
  const row = (await strapi.db.query('plugin::upload.file').create({
    data: {
      ...Object.fromEntries(FILE_ATTRIBUTES.map((name) => [name, fileData[name]])),
      formats: derived.length > 0 ? formats : null,
      provider: strapi.config.get('plugin::upload.provider'),
    },
  })) as { id: number }
  return row.id
}

// Strapi's `folderPath` is made of folder ids; the archive's of folder names, created when missing.
async function folderOf(strapi: Core.Strapi, folderPath: string): Promise<number | null> {
  let parent: number | null = null
  for (const name of folderPath.split('/').filter(Boolean)) {
    const found = (await strapi.db.query('plugin::upload.folder').findOne({
      where: { name, parent: parent === null ? { id: { $null: true } } : { id: parent } },
    })) as { id: number } | null
    const folder: { id: number } =
      found ??
      ((await strapi.plugin('upload').service('folder').create({ name, parent })) as { id: number })
    parent = folder.id
  }
  return parent
}

function isAllowed(mime: string, security: UploadSecurity): boolean {
  if (security.deniedTypes?.some((pattern) => matches(mime, pattern))) return false
  if (!Array.isArray(security.allowedTypes)) return true
  return security.allowedTypes.some((pattern) => matches(mime, pattern))
}

function matches(mime: string, pattern: string): boolean {
  if (pattern === '*' || pattern === '*/*') return true
  if (pattern.endsWith('/*')) return mime.startsWith(pattern.slice(0, -1))
  return mime === pattern
}

// What Strapi stores of a format: its fields, without the stream and path it was read from.
function withoutStreams(file: FileData): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(file).filter(
      ([key]) => !['getStream', 'filepath', 'stream', 'buffer'].includes(key)
    )
  )
}

function refused(entry: MediaEntry, why: string): ExportError {
  return new ExportError('exportMediaRefused', `Media file ${entry.name} is refused: ${why}`)
}
