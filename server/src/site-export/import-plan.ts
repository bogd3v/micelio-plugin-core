// What an import checks and resolves before it writes anything (`docs/export-format.md`,
// "Integrity" and "Import").
import type { Core, UID } from '@strapi/strapi'
import { findBlockOptionViolation } from '../block-options/rules'
import { EDITORIAL_ATTRIBUTE } from '../constants/editorial'
import { SITE_UID } from '../constants/site'
import { isEditorial } from '../editorial'
import type { StagedArchive } from './archive'
import { deserialiseData, type DeserialiseContext, type RefState } from './deserialise'
import { ExportError } from './errors'
import type { ExistingPolicy, ImportRequest } from './importer'
import { keepBoth } from './keep-both'
import { exportedTypes, type ExportedType, type Row } from './model'
import type { Attributes } from './serialise'
import type { ExportDocument } from './types'

/** The target's site, as an import resolves it. */
interface SiteRow {
  documentId: string
  slug: string
  hosts?: unknown
  isDefault?: boolean
}

/** What an import found out before writing: the archive, its types, the site and what exists. */
export interface Plan {
  staged: StagedArchive
  types: ExportedType[]
  site: SiteRow & { isNew: boolean }
  existing: ExistingPolicy
  /** An existing site keeps its identity: the import does not rewrite its name, hosts or url. */
  keepIdentity: boolean
  /** Whether the caller may publish a type; unset, nothing is held back. */
  canPublish: ((uid: string) => boolean) | undefined
  defaultLocale: string | undefined
  /** `<export name>:<documentId>` of every document the target or the archive holds. */
  targetHas: Set<string>
  inArchive: Set<string>
}

/**
 * Checks the archive against the target and resolves its site, before any write.
 *
 * @throws `ExportError` `exportLocaleMissing`, `exportEditorialInconsistent`,
 * `exportSiteNotFound`, `exportSiteSlugTaken`, `exportHostTaken` or `exportDocumentInvalid`.
 */
export async function planImport(
  strapi: Core.Strapi,
  staged: StagedArchive,
  types: ExportedType[],
  request: ImportRequest
): Promise<Plan> {
  const archiveSite = staged.contents.get('site')?.documents
  if (archiveSite?.length !== 1) {
    throw new ExportError('exportDocumentInvalid', 'An archive holds exactly one site')
  }
  const i18n = strapi.plugin('i18n')
  const defaultLocale = i18n
    ? ((await i18n.service('locales').getDefaultLocale()) as string)
    : undefined
  const locales = new Set(
    i18n ? ((await i18n.service('locales').find()) as { code: string }[]).map((l) => l.code) : []
  )
  const missing = new Set<string>()
  for (const type of types) {
    for (const document of staged.contents.get(type.name)!.documents) {
      for (const version of document.versions) {
        if (type.isLocalized && version.locale && !locales.has(version.locale)) {
          missing.add(version.locale)
        }
      }
      if (isEditorial(strapi.contentType(type.uid as UID.ContentType))) {
        checkEditorial(type, document)
      }
    }
  }
  if (missing.size > 0) {
    throw new ExportError(
      'exportLocaleMissing',
      `The target has no locale ${[...missing].sort().join(', ')}: add it before importing`
    )
  }

  const site = await targetSite(strapi, staged, request)
  const existing = request.existing ?? 'update'
  const plan: Plan = {
    staged: existing === 'keep-both' ? keepBoth(staged, site) : staged,
    types,
    site,
    existing,
    keepIdentity: request.keepIdentity === true,
    canPublish: request.canPublish,
    defaultLocale,
    targetHas: new Set(),
    inArchive: new Set(),
  }
  const referenced = new Map<string, Set<string>>()
  for (const type of types) {
    for (const document of plan.staged.contents.get(type.name)!.documents) {
      plan.inArchive.add(`${type.name}:${document.documentId}`)
      add(referenced, type.name, document.documentId)
      for (const version of document.versions) collectRefs(version.data, referenced)
    }
  }
  for (const type of all(types, strapi)) {
    const ids = [...(referenced.get(type.name) ?? [])]
    if (ids.length === 0) continue
    const rows = (await strapi.db.query(type.uid as UID.ContentType).findMany({
      select: ['documentId'],
      where: { documentId: { $in: ids } },
    })) as Row[]
    for (const row of rows) plan.targetHas.add(`${type.name}:${row.documentId}`)
  }
  return plan
}

/** Every type of the target, so that a reference to a document the archive does not hold resolves. */
export function all(types: ExportedType[], strapi: Core.Strapi): ExportedType[] {
  const known = new Set(types.map((type) => type.name))
  return [...types, ...exportedTypes(strapi, true).filter((type) => !known.has(type.name))]
}

async function targetSite(
  strapi: Core.Strapi,
  staged: StagedArchive,
  request: ImportRequest
): Promise<SiteRow & { isNew: boolean }> {
  const archived = staged.contents.get('site')!.documents[0]!
  const data = archived.versions[0]!.data
  const rows = (await strapi.db.query(SITE_UID as UID.ContentType).findMany({
    select: ['documentId', 'slug', 'hosts', 'isDefault'],
  })) as SiteRow[]
  const sites = [...new Map(rows.map((row) => [row.documentId, row])).values()]
  let site: (SiteRow & { isNew: boolean }) | undefined
  if (request.into) {
    const found = sites.find((row) => row.slug === request.into)
    if (!found) throw new ExportError('exportSiteNotFound', `There is no site "${request.into}"`)
    site = { ...found, isNew: false }
  } else {
    const found = sites.find((row) => row.documentId === archived.documentId)
    if (!found && sites.some((row) => row.slug === data.slug)) {
      throw new ExportError(
        'exportSiteSlugTaken',
        `Another site has the slug "${String(data.slug)}": import into it with \`into\``
      )
    }
    site = found
      ? { ...found, isNew: false }
      : { documentId: archived.documentId, slug: String(data.slug), isNew: true }
  }
  // Only a site the import writes takes the archive's hosts: with `skip`, `keep-both` and
  // `keepIdentity` an existing site keeps its own.
  const writesHosts =
    site.isNew || ((request.existing ?? 'update') === 'update' && request.keepIdentity !== true)
  const hosts = new Set(writesHosts ? asStrings(data.hosts).map((host) => host.toLowerCase()) : [])
  for (const other of sites) {
    if (other.documentId === site.documentId) continue
    const shared = asStrings(other.hosts).find((host) => hosts.has(host.toLowerCase()))
    if (shared) throw new ExportError('exportHostTaken', `Another site has the host ${shared}`)
  }
  return site
}

function checkEditorial(type: ExportedType, document: ExportDocument): void {
  const locales = new Set(document.versions.map((version) => version.locale))
  for (const locale of locales) {
    const versions = document.versions.filter((version) => version.locale === locale)
    const draft = versions.find((version) => version.status === 'draft')
    const isPublished = versions.some((version) => version.status === 'published')
    const state = (draft?.data[EDITORIAL_ATTRIBUTE] as { state?: unknown } | null | undefined)
      ?.state
    if (!draft || (state === 'published') !== isPublished) {
      throw new ExportError(
        'exportEditorialInconsistent',
        `${type.name} ${document.documentId} (${locale ?? 'no locale'}) is in state ` +
          `"${String(state)}" ${isPublished ? 'with' : 'without'} a published version`
      )
    }
  }
}

/**
 * A dry run of the deserialisation of every version, so that a version that does not fit the
 * target's schema refuses the archive before any write.
 *
 * @returns The references that resolve nowhere.
 * @throws `ExportError` `exportDocumentInvalid`.
 */
export function validate(strapi: Core.Strapi, plan: Plan): number {
  const context = deserialiseContext(strapi, plan, new Map(), undefined)
  let missing = 0
  for (const type of plan.types) {
    for (const document of plan.staged.contents.get(type.name)!.documents) {
      for (const version of document.versions) {
        const where = `${type.name} ${document.documentId} (${version.locale ?? 'no locale'})`
        const result = deserialiseData(type.attributes, version.data, context, where)
        missing += result.missing
        checkBlockOptions(type, result.data, where)
      }
    }
  }
  return missing
}

// The save of the importer refuses an option the catalogue does not allow (ADR-0018); checking it
// here refuses the archive before any write instead of halfway through.
function checkBlockOptions(type: ExportedType, data: Record<string, unknown>, where: string): void {
  for (const [name, attribute] of Object.entries(type.attributes)) {
    const zone = data[name]
    if ((attribute as { type?: string }).type !== 'dynamiczone' || !Array.isArray(zone)) continue
    const violation = findBlockOptionViolation(zone)
    if (!violation) continue
    const allowed = violation.allowed.length ? `; allowed: ${violation.allowed.join(', ')}` : ''
    throw new ExportError(
      'exportDocumentInvalid',
      `${where}.${name}: the ${violation.block} block does not allow that value for ` +
        `${violation.option}${allowed}`
    )
  }
}

/**
 * How references and media resolve on the target.
 *
 * @param written - The documents written so far; without it, every document of the archive counts
 * as there, for {@link validate}.
 */
export function deserialiseContext(
  strapi: Core.Strapi,
  plan: Plan,
  files: Map<string, number>,
  written: Set<string> | undefined
): DeserialiseContext {
  const names = new Map(all(plan.types, strapi).map((type) => [type.uid, type.name]))
  const media = new Set(plan.staged.media.map((entry) => entry.sha256))
  return {
    componentAttributes: (uid) =>
      strapi.components[uid as UID.Component]?.attributes as Attributes | undefined,
    exportNameOf: (uid) => names.get(uid),
    // Without `written`, a check before any write: every document of the archive counts as there.
    refState(name, documentId): RefState {
      const key = `${name}:${documentId}`
      if (written?.has(key) || (plan.targetHas.has(key) && !plan.inArchive.has(key))) {
        return 'present'
      }
      if (plan.inArchive.has(key)) return written ? 'later' : 'present'
      return 'missing'
    },
    fileOf: (sha256) => files.get(sha256),
    hasMedia: (sha256) => media.has(sha256),
  }
}

/** The data of the archive's site, in its first version. */
export function siteData(plan: Plan): Record<string, unknown> {
  return plan.staged.contents.get('site')!.documents[0]!.versions[0]!.data
}

/** The role codes of a site's `editorialPolicy` that no admin role of the target has. */
export async function unknownRoles(
  strapi: Core.Strapi,
  site: Record<string, unknown>
): Promise<string[]> {
  const policy = site.editorialPolicy
  if (!policy || typeof policy !== 'object') return []
  const codes = new Set(
    Object.values(policy as Record<string, unknown>).flatMap((roles) => asStrings(roles))
  )
  const roles = (await strapi.db.query('admin::role').findMany({ select: ['code'] })) as {
    code: string
  }[]
  const known = new Set(roles.map((role) => role.code))
  return [...codes].filter((code) => !known.has(code)).sort()
}

function collectRefs(value: unknown, refs: Map<string, Set<string>>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs)
  } else if (value && typeof value === 'object') {
    const { ref, documentId } = value as { ref?: unknown; documentId?: unknown }
    if (typeof ref === 'string' && typeof documentId === 'string') add(refs, ref, documentId)
    else for (const item of Object.values(value)) collectRefs(item, refs)
  }
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  map.set(key, (map.get(key) ?? new Set()).add(value))
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}
