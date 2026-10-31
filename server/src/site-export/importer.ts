// Writes an archive of format 1.x into an instance (`docs/export-format.md`, "Import").
import type { Readable } from 'node:stream'
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'
import { runAsTransition } from '../editorial/context'
import { SITE_ATTRIBUTE } from '../site-scope'
import { withStagedArchive, type StagedArchive } from './archive'
import {
  deserialiseContext,
  planImport,
  siteData,
  unknownRoles,
  validate,
  type Plan,
} from './import-plan'
import { deserialiseData, type DeserialiseContext } from './deserialise'
import {
  canonical,
  inspectDocument,
  isDraftOnly as inspectDraftOnly,
  serialiseContext,
} from './inspect'
import { compare, exportedTypes, siteRowsOf, type ExportedType } from './model'
import { readSections } from './sections'
import { removeMedia, storeMedia } from './store-media'
import type { SectionImportReport } from '../types/extensions'
import type { ExportDocument, ExportVersion } from './types'

/** What an import does with a document the target already holds. */
export type ExistingPolicy = 'skip' | 'update' | 'keep-both'

/** How to import. */
export interface ImportRequest {
  /**
   * `merge` leaves the site's documents the archive does not hold; `replace` deletes them.
   *
   * @defaultValue 'merge'
   */
  mode?: 'merge' | 'replace'
  /**
   * What to do with a document the target already holds: `update` rewrites it with the archive's
   * versions, `skip` leaves it as it is, `keep-both` writes the archive's document as a new one,
   * with a `documentId` derived from the target's site and the archive's, so that importing the
   * same archive again writes nothing.
   *
   * @remarks
   * The site's own settings are rewritten only by `update`. `replace` mode and `skip` do not mix
   * well: `replace` still deletes what the archive does not hold.
   *
   * @defaultValue 'update', which is what `merge` always did.
   */
  existing?: ExistingPolicy
  /**
   * The slug of an existing site of the target to import into, instead of the archive's own site.
   * It keeps its slug and whether it is the default.
   */
  into?: string
  /**
   * An existing site keeps its `name`, `hosts`, `url` and default locale whatever the policy; the
   * rest of its settings follow `existing`. The Export and import page always sets it.
   *
   * @defaultValue false
   */
  keepIdentity?: boolean
  /**
   * Whether the caller may publish a type. A type it may not publish arrives as a draft: its
   * published versions are written as drafts and nothing is unpublished. Unset, the import is a
   * restore and writes what the archive says.
   */
  canPublish?: (uid: string) => boolean
  /** The most the archive may hold uncompressed, in bytes; an archive over it is refused. */
  maxBytes?: number
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
  /** What each plugin section's `read` did, by section `id`. */
  plugins: Record<string, SectionImportReport>
  /** Sections of the archive that were not read: no plugin registered them, or another major. */
  skippedPlugins: { id: string; reason: 'unknown' | 'version' }[]
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
  return withStagedArchive(
    source,
    (staged) => importStaged(strapi, staged, request),
    request.maxBytes
  )
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
    plugins: {},
    skippedPlugins: [],
  }

  const plan = await planImport(strapi, staged, types, request)
  report.site = { documentId: plan.site.documentId, slug: plan.site.slug }
  report.unknownRoles = await unknownRoles(strapi, siteData(plan))
  report.missingReferences = validate(strapi, plan)

  const media = await storeMedia(strapi, staged.media, staged.mediaFiles)
  report.media = { stored: media.uploaded.length, reused: media.reused }
  try {
    await strapi.db.transaction(() =>
      runAsTransition(async () => {
        await writeContent(strapi, plan, media.files, request, report)
        const sections = await readSections(strapi, staged.manifest.plugins, staged.sections, {
          documentId: plan.site.documentId,
          slug: plan.site.slug,
        })
        report.plugins = sections.sections
        report.skippedPlugins = sections.skipped
      })
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
  const query = strapi.db.query(type.uid as UID.ContentType)
  const { rows, desired, result } = await inspectDocument(strapi, plan, type, document, shaOf)
  const isDraftOnly = inspectDraftOnly(plan, type)
  if (result === 'skipped') return { result, pending: false }

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
      // Unpublishing is publishing's permission too: a draft-only import leaves it as it is.
      if (!isDraftOnly && rows.some((row) => (row.locale ?? null) === code && row.publishedAt)) {
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
