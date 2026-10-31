// What an import finds out about one document of the archive before it writes it: the decision
// both the import and its dry run take (`docs/export-format.md`, "Import").
import type { Core, UID } from '@strapi/strapi'
import { EDITORIAL_ATTRIBUTE } from '../constants/editorial'
import { SITE_UID } from '../constants/site'
import { SITE_ATTRIBUTE } from '../site-scope'
import { all, type Plan } from './import-plan'
import { knownData } from './deserialise'
import { ExportError } from './errors'
import { compare, documentsOf, type ExportedType, type Row } from './model'
import { populateOf, type Attributes, type SerialiseContext, type StoredFile } from './serialise'
import type { ExportDocument, ExportVersion } from './types'

/** What an import does with one document of the archive. */
export type DocumentResult = 'created' | 'replaced' | 'skipped'

/** A document of the archive set against what the target holds. */
export interface Inspection {
  /** The target's stored rows of the document; empty when it has none. */
  rows: Row[]
  /** The archive's versions as the target would hold them. */
  desired: ExportVersion[]
  result: DocumentResult
  /** The archive holds a published or scheduled version that the import writes as a draft: the caller may not publish. */
  asDraft: boolean
}

/** The attributes of an existing site that an import with `keepIdentity` never rewrites. */
const KEPT_IDENTITY = ['name', 'hosts', 'url', 'defaultLocale']

/** Whether the import writes no published version of a type: the caller may not publish it. */
export function isDraftOnly(plan: Plan, type: ExportedType): boolean {
  return type.hasDrafts && plan.canPublish !== undefined && !plan.canPublish(type.uid)
}

/**
 * Sets a document of the archive against the target and decides what the import does with it.
 *
 * @remarks
 * A document the target holds as the archive has it is `skipped`; so is one it holds differently
 * when the policy is `skip` or `keep-both`, which never rewrite a document that exists. The site
 * of an existing target site is such a document: only `update` rewrites its settings.
 *
 * @param shaOf - The SHA-256 of each library file the target's documents reference.
 * @throws `ExportError` `exportDocumentInvalid` when the document belongs to another site.
 */
export async function inspectDocument(
  strapi: Core.Strapi,
  plan: Plan,
  type: ExportedType,
  document: ExportDocument,
  shaOf: Map<number, string>
): Promise<Inspection> {
  const isSite = type.uid === SITE_UID
  const documentId = isSite ? plan.site.documentId : document.documentId
  const skip = new Set(isSite ? [] : [SITE_ATTRIBUTE])
  const context = serialiseContext(strapi, plan, shaOf)
  const rows = (await strapi.db.query(type.uid as UID.ContentType).findMany({
    where: { documentId },
    populate: populateOf(type.attributes, context, skip),
  })) as Row[]
  if (!isSite && rows.length > 0) await checkOwner(strapi, type, documentId, plan.site.documentId)
  const existing = documentsOf(type, rows, context)[0]
  const versions = document.versions.map((version) => ({
    ...version,
    locale: type.isLocalized ? (version.locale ?? plan.defaultLocale ?? null) : null,
    data: desiredData(type, version, plan, rows),
  }))
  const asDraft = isDraftOnly(plan, type) && versions.some(reachesPublication)
  const desired = asDraft ? drafted(versions) : versions
  const isHeld = existing !== undefined && isSame(existing.versions, desired)
  const keeps = rows.length > 0 && plan.existing !== 'update'
  if (isHeld || keeps) return { rows, desired, result: 'skipped', asDraft }
  return { rows, desired, result: rows.length > 0 ? 'replaced' : 'created', asDraft }
}

// A version that is published, or a draft the scheduler would publish.
function reachesPublication(version: ExportVersion): boolean {
  if (version.status === 'published') return true
  return editorialOf(version)?.state === 'scheduled'
}

function editorialOf(version: ExportVersion): { state?: unknown } | null | undefined {
  return version.data[EDITORIAL_ATTRIBUTE] as { state?: unknown } | null | undefined
}

// Each locale keeps its draft, or its published version as a draft, with the editorial state that
// goes with it and no schedule: what the caller may not publish arrives as a draft, and the
// scheduler (which publishes as the system) never gets it.
function drafted(versions: ExportVersion[]): ExportVersion[] {
  const locales = [...new Set(versions.map((version) => version.locale))]
  return locales.map((locale) => {
    const own = versions.filter((version) => version.locale === locale)
    const draft = own.find((version) => version.status === 'draft')
    const kept = draft ?? { ...own[0]!, status: 'draft' as const, publishedAt: null }
    const editorial = editorialOf(kept)
    if (editorial?.state !== 'published' && editorial?.state !== 'scheduled') return kept
    return {
      ...kept,
      data: {
        ...kept.data,
        [EDITORIAL_ATTRIBUTE]: { ...editorial, state: 'draft', publishAt: null },
      },
    }
  })
}

// What the target should hold for a version: the attributes it knows, and for the site its own
// default flag, and its slug when the archive is imported into another site; with `keepIdentity`
// an existing site keeps its name, hosts, url and default locale too.
function desiredData(
  type: ExportedType,
  version: ExportVersion,
  plan: Plan,
  rows: Row[]
): Record<string, never> {
  const data = knownData(type.attributes, version.data)
  if (type.uid === SITE_UID) {
    data.isDefault = rows[0]?.isDefault === true
    if (!plan.site.isNew) {
      data.slug = plan.site.slug
      if (plan.keepIdentity) for (const name of KEPT_IDENTITY) delete data[name]
    }
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
      `${type.name} ${documentId} belongs to another site of the target`,
      'otherSite'
    )
  }
}

/** How the target's stored documents are written back as archive data. */
export function serialiseContext(
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

/** The JSON of a value with its keys in byte order, so that equal data compares equal. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => compare(a, b))
        )
      : item
  )
}
