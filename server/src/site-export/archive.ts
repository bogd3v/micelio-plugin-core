// Reads an archive into a staging folder and checks it whole before an import writes anything
// (`docs/export-format.md`, "Integrity").
import { createHash } from 'node:crypto'
import { createWriteStream, type WriteStream } from 'node:fs'
import { once } from 'node:events'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { z } from 'zod'
import { EXPORT_FORMAT, MANIFEST_PATH, MEDIA_FOLDER, MEDIA_INDEX_PATH } from './constants'
import { ExportError } from './errors'
import { readTar, type TarSink } from './tar'
import type { ContentFile, Manifest, MediaEntry } from './types'

/** An archive read and checked: what an import works from. */
export interface StagedArchive {
  manifest: Manifest
  /** The content files of the export names the manifest lists, by export name. */
  contents: Map<string, ContentFile>
  media: MediaEntry[]
  /** Where each media file was staged, by SHA-256. */
  mediaFiles: Map<string, string>
}

// The JSON files of an archive are held in memory: their total is bounded.
const MAX_JSON_BYTES = 256 * 1024 * 1024
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/
const MEDIA_PATH = new RegExp(`^${MEDIA_FOLDER}/([0-9a-f]{64})$`)
const FORMAT_VERSION = /^(\d+)\.(\d+)$/
/** The major of the format this release reads. */
const READ_MAJOR = 1

const digest = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().min(0),
})
const manifestSchema = z.looseObject({
  format: z.string(),
  formatVersion: z.string(),
  exportedAt: z.string(),
  generator: z.looseObject({ name: z.string(), version: z.string() }),
  micelio: z.string(),
  strapi: z.string(),
  site: z.looseObject({ documentId: z.string().min(1), slug: z.string().min(1) }),
  locales: z.array(z.looseObject({ code: z.string(), name: z.string(), isDefault: z.boolean() })),
  theme: z.looseObject({ id: z.string() }).nullable(),
  fediverse: z.looseObject({ actorId: z.string(), handle: z.string() }).nullable(),
  personal: z.boolean(),
  types: z.array(
    z.looseObject({ name: z.string(), uid: z.string(), file: z.string(), documents: z.number() })
  ),
  media: z.looseObject({ file: z.string(), count: z.number(), bytes: z.number() }),
  files: z.record(z.string(), digest),
})
const version = z.looseObject({
  locale: z.string().nullable(),
  status: z.enum(['draft', 'published']),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
})
const contentSchema = z.looseObject({
  type: z.string(),
  documents: z.array(
    z.looseObject({ documentId: z.string().min(1).max(64), versions: z.array(version).min(1) })
  ),
})
const mediaIndexSchema = z.looseObject({
  media: z.array(
    z.looseObject({
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      name: z.string().min(1),
      mime: z.string().min(1),
      ext: z.string().nullable(),
      bytes: z.number().int().min(0),
      width: z.number().nullable(),
      height: z.number().nullable(),
      alternativeText: z.string().nullable(),
      caption: z.string().nullable(),
      folderPath: z.string(),
    })
  ),
})

/**
 * Reads a gzip-compressed archive into `directory` and checks it.
 *
 * @remarks
 * Every size and SHA-256 of the manifest is checked against the bytes read, every file read must
 * be in the manifest, and every content file is checked for shape, before this answers. Media
 * files are staged in `directory`, which the caller removes.
 *
 * @throws `ExportError` `exportArchiveCorrupt`, `exportFormatUnsupported` or
 * `exportDocumentInvalid`.
 */
export async function stageArchive(source: Readable, directory: string): Promise<StagedArchive> {
  const json = new Map<string, Buffer>()
  const seen = new Map<string, { sha256: string; bytes: number }>()
  const mediaFiles = new Map<string, string>()
  let manifest: Manifest | undefined
  let jsonBytes = 0

  const open = (entry: { path: string; type: string; bytes: number }): TarSink => {
    const name = entry.type === 'directory' ? entry.path.replace(/\/$/, '') : entry.path
    if (!SAFE_PATH.test(name)) throw corrupt(`"${entry.path}" is not a path an archive may hold`)
    if (entry.type === 'directory') return { write() {}, end() {} }
    if (seen.has(name) || json.has(name)) throw corrupt(`${name} is in the archive twice`)
    const listed = manifest?.files[name]
    if (manifest && !listed) throw corrupt(`${name} is not in the manifest`)
    if (listed && entry.bytes !== listed.bytes) throw corrupt(`${name} is not the size listed`)
    const hash = createHash('sha256')
    const media = MEDIA_PATH.exec(name)
    if (media) {
      // Media comes after the manifest in byte order, so its size is already bounded by it.
      if (!manifest) throw corrupt(`${name} comes before the manifest`)
      const file = path.join(directory, media[1]!)
      const stream = createWriteStream(file)
      mediaFiles.set(media[1]!, file)
      return streamSink(stream, hash, () => seen.set(name, done(hash, entry.bytes)))
    }
    jsonBytes += entry.bytes
    if (jsonBytes > MAX_JSON_BYTES) throw corrupt('The JSON files of the archive are too large')
    const chunks: Buffer[] = []
    return {
      write(chunk) {
        hash.update(chunk)
        chunks.push(chunk)
      },
      end() {
        const body = Buffer.concat(chunks)
        if (name === MANIFEST_PATH) {
          manifest = parseManifest(body)
          // The files read before the manifest are checked against it now.
          for (const earlier of [...seen.keys(), ...json.keys()]) {
            if (!manifest.files[earlier]) throw corrupt(`${earlier} is not in the manifest`)
          }
        } else {
          json.set(name, body)
          seen.set(name, done(hash, entry.bytes))
        }
      },
    }
  }

  try {
    await readTar(source.pipe(createGunzip()), open)
  } catch (error) {
    if (error instanceof ExportError) throw error
    throw corrupt(error instanceof Error ? error.message : 'The archive cannot be read')
  }
  if (!manifest) throw corrupt('The archive has no manifest')
  for (const [name, listed] of Object.entries(manifest.files)) {
    const read = seen.get(name)
    if (!read) throw corrupt(`${name} is in the manifest and not in the archive`)
    if (read.sha256 !== listed.sha256 || read.bytes !== listed.bytes) {
      throw corrupt(`${name} does not match its SHA-256`)
    }
    const media = MEDIA_PATH.exec(name)
    if (media && media[1] !== read.sha256) throw corrupt(`${name} is not named by its SHA-256`)
  }

  const contents = new Map<string, ContentFile>()
  for (const type of manifest.types) {
    const body = json.get(type.file)
    if (!body) throw corrupt(`${type.file} of ${type.name} is not in the archive`)
    const content = parseJson(body, contentSchema, type.file) as unknown as ContentFile
    if (content.type !== type.name) throw invalid(`${type.file} holds "${content.type}"`)
    contents.set(type.name, content)
  }
  const index = json.get(MEDIA_INDEX_PATH)
  const media = index
    ? (parseJson(index, mediaIndexSchema, MEDIA_INDEX_PATH).media as MediaEntry[])
    : []
  for (const entry of media) {
    if (!mediaFiles.has(entry.sha256))
      throw corrupt(`Media file ${entry.sha256} is not in the archive`)
  }
  return { manifest, contents, media, mediaFiles }
}

function parseManifest(body: Buffer): Manifest {
  let value: unknown
  try {
    value = JSON.parse(body.toString('utf8'))
  } catch {
    throw corrupt('The manifest is not JSON')
  }
  const head = z.looseObject({ format: z.string(), formatVersion: z.string() }).safeParse(value)
  const major = head.success ? FORMAT_VERSION.exec(head.data.formatVersion)?.[1] : undefined
  if (!head.success || head.data.format !== EXPORT_FORMAT || Number(major) !== READ_MAJOR) {
    throw new ExportError(
      'exportFormatUnsupported',
      `This release reads format ${READ_MAJOR}.x of ${EXPORT_FORMAT}`
    )
  }
  const parsed = manifestSchema.safeParse(value)
  if (!parsed.success)
    throw corrupt(`The manifest is not valid: ${parsed.error.issues[0]?.message}`)
  return parsed.data as unknown as Manifest
}

function parseJson(body: Buffer, schema: z.ZodType, file: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(body.toString('utf8'))
  } catch {
    throw invalid(`${file} is not JSON`)
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw invalid(`${file} is not valid at ${issue?.path.join('.') ?? ''}: ${issue?.message ?? ''}`)
  }
  return parsed.data as Record<string, unknown>
}

function streamSink(
  stream: WriteStream,
  hash: ReturnType<typeof createHash>,
  finish: () => void
): TarSink {
  return {
    async write(chunk) {
      hash.update(chunk)
      if (!stream.write(chunk)) await once(stream, 'drain')
    },
    async end() {
      stream.end()
      await once(stream, 'finish')
      finish()
    },
  }
}

function done(
  hash: ReturnType<typeof createHash>,
  bytes: number
): { sha256: string; bytes: number } {
  return { sha256: hash.digest('hex'), bytes }
}

function corrupt(message: string): ExportError {
  return new ExportError('exportArchiveCorrupt', message)
}

function invalid(message: string): ExportError {
  return new ExportError('exportDocumentInvalid', message)
}
