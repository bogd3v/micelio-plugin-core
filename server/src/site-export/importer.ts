// Writes an archive of format 1.x into an instance (`docs/export-format.md`, "Import").
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Readable } from 'node:stream'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'
import { runAsTransition } from '../editorial/context'
import { SITE_ATTRIBUTE } from '../site-scope'
import { stageArchive, type StagedArchive } from './archive'
import {
  all,
  deserialiseContext,
  planImport,
  siteData,
  unknownRoles,
  validate,
  type Plan,
} from './import-plan'
import { deserialiseData, knownData, type DeserialiseContext } from './deserialise'
import { ExportError } from './errors'
import {
  compare,
  documentsOf,
  exportedTypes,
  siteRowsOf,
  type ExportedType,
  type Row,
} from './model'
import { populateOf, type Attributes, type SerialiseContext, type StoredFile } from './serialise'
import { removeMedia, storeMedia } from './store-media'
import type { ExportDocument, ExportVersion } from './types'

/** How to import. */
export interface ImportRequest {
  /**
   * `merge` leaves the site's documents the archive does not hold; `replace` deletes them.
   *
   * @defaultValue 'merge'
   */
  mode?: 'merge' | 'replace'
  /**
   * The slug of an existing site of the target to import into, instead of the archive's own site.
   * It keeps its slug and whether it is the default.
   */
  into?: string
}

/** What an import did to the documents of one export name. */
export interface ImportTypeReport {
  created: number
  replaced: number
  deleted: number
  /** Documents the target already held as the archive does: nothing was written. */
  skipped: number
}

/** What an import did. */
export interface ImportReport {
  /** The target's site the archive was written into. */
  site: { documentId: string; slug: string }
  types: Record<string, ImportTypeReport>
  /** Export names of the archive the target has no type for: not imported. */
  unknownTypes: string[]
  /** Role codes of the site's `editorialPolicy` the target does not have: they grant nothing. */
  unknownRoles: string[]
  /** References to documents neither the archive nor the target holds: left out. */
  missingReferences: number
  media: { stored: number; reused: number }
}

/**
 * Imports a gzip-compressed archive and answers what it did.
 *
 * @remarks
 * Nothing is written until the whole archive is read and checked. The media is stored first, then
 * the content in one database transaction; when the transaction fails the media it stored is
 * removed. The import is a restore: published versions are written as they are, without the
 * transition policy and without the editorial hooks.
 *
 * @throws `ExportError` with one of the codes of the specification.
 */
export async function importSite(
  strapi: Core.Strapi,
  source: Readable,
  request: ImportRequest = {}
): Promise<ImportReport> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'micelio-import-'))
  try {
    const staged = await stageArchive(source, directory)
    return await importStaged(strapi, staged, request)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function importStaged(
  strapi: Core.Strapi,
  staged: StagedArchive,
  request: ImportRequest
): Promise<ImportReport> {
  const all = exportedTypes(strapi, true)
  const archived = new Set(staged.manifest.types.map((type) => type.name))
  const types = all.filter((type) => archived.has(type.name))
  const report: ImportReport = {
    site: { documentId: '', slug: '' },
    types: Object.fromEntries(
      types.map((type) => [type.name, { created: 0, replaced: 0, deleted: 0, skipped: 0 }])
    ),
    unknownTypes: [...archived].filter((name) => !all.some((type) => type.name === name)).sort(),
    unknownRoles: [],
    missingReferences: 0,
    media: { stored: 0, reused: 0 },
  }

  const plan = await planImport(strapi, staged, types, request)
  report.site = { documentId: plan.site.documentId, slug: plan.site.slug }
  report.unknownRoles = await unknownRoles(strapi, siteData(plan))
  report.missingReferences = validate(strapi, plan)

  const media = await storeMedia(strapi, staged.media, staged.mediaFiles)
  report.media = { stored: media.uploaded.length, reused: media.reused }
  try {
    await strapi.db.transaction(() =>
      runAsTransition(() => writeContent(strapi, plan, media.files, request, report))
    )
  } catch (error) {
    await removeMedia(strapi, media.uploaded)
    throw error
  }
  return report
}

async function writeContent(
  strapi: Core.Strapi,
  plan: Plan,
  files: Map<string, number>,
  request: ImportRequest,
  report: ImportReport
): Promise<void> {
  const written = new Set<string>()
  // A document of the archive the target already holds can be referenced before it is rewritten.
  for (const key of plan.inArchive) if (plan.targetHas.has(key)) written.add(key)
  const context = deserialiseContext(strapi, plan, files, written)
  const shaOf = new Map([...files.entries()].map(([sha256, id]) => [id, sha256]))
  const ordered = [...plan.types].sort((a, b) =>
    a.uid === SITE_UID ? -1 : b.uid === SITE_UID ? 1 : compare(a.name, b.name)
  )
  const pending: [ExportedType, ExportDocument][] = []
  for (const type of ordered) {
    for (const document of plan.staged.contents.get(type.name)!.documents) {
      const outcome = await writeDocument(strapi, plan, type, document, context, shaOf)
      written.add(`${type.name}:${document.documentId}`)
      report.types[type.name]![outcome.result] += 1
      if (outcome.pending) pending.push([type, document])
    }
  }
  // The references to documents written after them are linked now that every document exists.
  for (const [type, document] of pending) {
    await writeDocument(strapi, plan, type, document, context, shaOf)
  }
  if (request.mode === 'replace') {
    for (const type of ordered) {
      if (type.uid === SITE_UID) continue
      const kept = new Set(plan.staged.contents.get(type.name)!.documents.map((d) => d.documentId))
      const rows = await siteRowsOf(strapi, type, plan.site, serialiseContext(strapi, plan, shaOf))
      for (const documentId of new Set(rows.map((row) => row.documentId))) {
        if (kept.has(documentId)) continue
        await strapi.documents(type.uid as UID.ContentType).delete({ documentId, locale: '*' })
        report.types[type.name]!.deleted += 1
      }
    }
  }
}

async function writeDocument(
  strapi: Core.Strapi,
  plan: Plan,
  type: ExportedType,
  document: ExportDocument,
  context: DeserialiseContext,
  shaOf: Map<number, string>
): Promise<{ result: 'created' | 'replaced' | 'skipped'; pending: boolean }> {
  const isSite = type.uid === SITE_UID
  const documentId = isSite ? plan.site.documentId : document.documentId
  const skip = new Set(isSite ? [] : [SITE_ATTRIBUTE])
  const query = strapi.db.query(type.uid as UID.ContentType)
  const rows = (await query.findMany({
    where: { documentId },
    populate: populateOf(type.attributes, serialiseContext(strapi, plan, shaOf), skip),
  })) as Row[]
  if (!isSite && rows.length > 0) await checkOwner(strapi, type, documentId, plan.site.documentId)
  const existing = documentsOf(type, rows, serialiseContext(strapi, plan, shaOf))[0]
  const desired = document.versions.map((version) => ({
    ...version,
    locale: type.isLocalized ? (version.locale ?? plan.defaultLocale ?? null) : null,
    data: desiredData(type, version, plan, rows),
  }))
  if (existing && isSame(existing.versions, desired)) return { result: 'skipped', pending: false }

  const documents = strapi.documents(type.uid as UID.ContentType)
  let exists = rows.length > 0
  let pending = false
  const put = async (version: ExportVersion, locale: string | undefined): Promise<void> => {
    const where = `${type.name} ${document.documentId} (${locale ?? 'no locale'})`
    const result = deserialiseData(type.attributes, version.data, context, where)
    pending ||= result.pending > 0
    const data: Record<string, unknown> = { ...result.data }
    if (!exists) {
      if (!isSite) data[SITE_ATTRIBUTE] = plan.site.documentId
      await documents.create({ locale, data: { ...data, documentId } } as never)
      exists = true
    } else {
      await documents.update({ documentId, locale, data } as never)
    }
  }

  const locales = [...new Set(desired.map((version) => version.locale))].sort((a, b) =>
    a === plan.defaultLocale ? -1 : b === plan.defaultLocale ? 1 : compare(a ?? '', b ?? '')
  )
  for (const code of locales) {
    const locale = code ?? undefined
    const versions = desired.filter((version) => version.locale === code)
    const draft = versions.find((version) => version.status === 'draft')
    const published = versions.find((version) => version.status === 'published')
    if (!type.hasDrafts) {
      await put(versions[0]!, locale)
      continue
    }
    if (published) {
      // Strapi publishes the draft: the published data goes in first, the draft's after it.
      await put(published, locale)
      await documents.publish({ documentId, locale } as never)
      if (draft && canonical(draft.data) !== canonical(published.data)) await put(draft, locale)
    } else {
      if (draft) await put(draft, locale)
      if (rows.some((row) => (row.locale ?? null) === code && row.publishedAt)) {
        await documents.unpublish({ documentId, locale } as never)
      }
    }
  }
  // The archive's versions replace the document's: a locale it does not hold is deleted.
  for (const code of new Set(rows.map((row) => row.locale ?? null))) {
    if (type.isLocalized && code && !locales.includes(code)) {
      await documents.delete({ documentId, locale: code } as never)
    }
  }
  for (const version of desired) {
    await query.updateMany({
      where: {
        documentId,
        ...(type.isLocalized ? { locale: version.locale } : {}),
        publishedAt: version.status === 'published' ? { $notNull: true } : { $null: true },
      },
      data: {
        createdAt: version.createdAt ?? undefined,
        updatedAt: version.updatedAt ?? undefined,
        ...(version.status === 'published' ? { publishedAt: version.publishedAt } : {}),
      },
    })
  }
  return { result: rows.length > 0 ? 'replaced' : 'created', pending }
}

// What the target should hold for a version: the attributes it knows, and for the site its own
// default flag, and its slug when the archive is imported into another site.
function desiredData(
  type: ExportedType,
  version: ExportVersion,
  plan: Plan,
  rows: Row[]
): Record<string, never> {
  const data = knownData(type.attributes, version.data)
  if (type.uid === SITE_UID) {
    data.isDefault = rows[0]?.isDefault === true
    if (!plan.site.isNew) data.slug = plan.site.slug
  }
  return data as Record<string, never>
}

async function checkOwner(
  strapi: Core.Strapi,
  type: ExportedType,
  documentId: string,
  site: string
): Promise<void> {
  const rows = (await strapi.db.query(type.uid as UID.ContentType).findMany({
    where: { documentId },
    populate: { [SITE_ATTRIBUTE]: { select: ['documentId'] } },
  })) as { site?: { documentId?: string } | null }[]
  if (rows.some((row) => row.site?.documentId && row.site.documentId !== site)) {
    throw new ExportError(
      'exportDocumentInvalid',
      `${type.name} ${documentId} belongs to another site of the target`
    )
  }
}

function serialiseContext(
  strapi: Core.Strapi,
  plan: Plan,
  shaOf: Map<number, string>
): SerialiseContext {
  const names = new Map(all(plan.types, strapi).map((type) => [type.uid, type.name]))
  return {
    componentAttributes: (uid) =>
      (strapi.components[uid as UID.Component]?.attributes ?? {}) as Attributes,
    exportNameOf: (uid) => names.get(uid),
    mediaRef: (file: StoredFile) => ({ media: shaOf.get(file.id) ?? `file:${file.id}` }),
    personal: true,
  }
}

// The archive's versions equal the target's on everything the archive says.
function isSame(existing: ExportVersion[], desired: ExportVersion[]): boolean {
  if (existing.length !== desired.length) return false
  return desired.every((version) => {
    const match = existing.find(
      (other) => other.locale === version.locale && other.status === version.status
    )
    if (!match) return false
    const stored = Object.fromEntries(
      Object.keys(version.data).map((key) => [key, match.data[key]])
    )
    return (
      match.createdAt === version.createdAt &&
      match.updatedAt === version.updatedAt &&
      match.publishedAt === version.publishedAt &&
      canonical(stored) === canonical(version.data)
    )
  })
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => compare(a, b))
        )
      : item
  )
}
