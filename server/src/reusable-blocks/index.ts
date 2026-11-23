// What the reusable blocks read from a running Strapi: the zone of the type, the fields that
// reference it and the pages that do (ADR-0022, section 1).
import type { Core, UID } from '@strapi/strapi'
import { REUSABLE_BLOCK_UID, REUSABLE_BLOCKS_ATTRIBUTE } from '../constants/reusable-blocks'
import { isSiteScoped, SITE_ATTRIBUTE } from '../site-scope'
import type { ReferencingPage } from './error'
import { referenceFieldsOf, zoneComponentsOf, type ReferenceField, type SchemaOf } from './rules'

type Row = Record<string, unknown> & { documentId: string; locale?: string | null }

const schemasOf = (registry: unknown) => registry as Record<string, SchemaOf>

/**
 * Gives the zone of `plugin::micelio.reusable-block` the page blocks of the catalogue that the host
 * registers, never the one that references a reusable block.
 *
 * @remarks
 * The block components belong to the host until the cut-over (C3 of
 * `docs/architecture/content-types-plan.md`), so the schema lists none and this fills them in.
 * It must run in `register`, before Strapi turns the types into database models.
 */
export function fillReusableBlockZone(strapi: Core.Strapi): void {
  const type = strapi.contentTypes[REUSABLE_BLOCK_UID as UID.ContentType] as unknown as {
    attributes: Record<string, { components?: string[] }>
    __schema__?: { attributes?: Record<string, { components?: string[] }> }
  }
  const components = zoneComponentsOf(schemasOf(strapi.components))
  for (const attributes of [type.attributes, type.__schema__?.attributes]) {
    const zone = attributes?.[REUSABLE_BLOCKS_ATTRIBUTE]
    if (zone) zone.components = [...components]
  }
}

const fieldsOf = new WeakMap<Core.Strapi, ReferenceField[]>()

/**
 * The fields of the site-scoped types that reference reusable blocks, read from the schemas once,
 * when first asked after the boot: never from a page UID.
 */
export function referenceFields(strapi: Core.Strapi): ReferenceField[] {
  let fields = fieldsOf.get(strapi)
  if (!fields) {
    fields = referenceFieldsOf(
      schemasOf(strapi.contentTypes),
      schemasOf(strapi.components),
      isSiteScoped
    )
    fieldsOf.set(strapi, fields)
  }
  return fields
}

/** The `documentId`s of the documents of a type that have a row in the site. */
async function documentsOfSite(
  strapi: Core.Strapi,
  uid: string,
  site: string,
  where: Record<string, unknown> = {}
): Promise<string[]> {
  const rows = (await strapi.db.query(uid as UID.ContentType).findMany({
    select: ['documentId'],
    where: { ...where, [SITE_ATTRIBUTE]: { documentId: site } },
  })) as Row[]
  return [...new Set(rows.map((row) => row.documentId))]
}

/** The `documentId` of the site of a reusable block, or `undefined` when it has none. */
export async function siteOfReusableBlock(
  strapi: Core.Strapi,
  documentId: string
): Promise<string | undefined> {
  const rows = (await strapi.db.query(REUSABLE_BLOCK_UID as UID.ContentType).findMany({
    where: { documentId },
    populate: { [SITE_ATTRIBUTE]: { select: ['documentId'] } },
  })) as { site?: { documentId: string } | null }[]
  return rows.find((row) => row.site)?.site?.documentId
}

/**
 * Of the given reusable blocks, those that belong to the site: a document belongs to it when one of
 * its rows does.
 */
export async function reusableBlocksOfSite(
  strapi: Core.Strapi,
  documentIds: readonly string[],
  site: string
): Promise<Set<string>> {
  if (documentIds.length === 0) return new Set()
  return new Set(
    await documentsOfSite(strapi, REUSABLE_BLOCK_UID, site, {
      documentId: { $in: [...new Set(documentIds)] },
    })
  )
}

/** The targets of a populated relation, one or many. */
export function targetsOf(value: unknown): { documentId?: unknown; locale?: unknown }[] {
  const list = Array.isArray(value) ? value : [value]
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
}

/** The `populate` of a type's rows that reads the targets of its fields: `documentId` and `locale`. */
function referencePopulate(fields: readonly ReferenceField[]): Record<string, unknown> {
  const populate: Record<string, { on: Record<string, { populate: Record<string, unknown> }> }> = {}
  for (const field of fields) {
    const zone = (populate[field.zone] ??= { on: {} })
    const on = (zone.on[field.component] ??= { populate: {} })
    on.populate[field.attribute] = { select: ['documentId', 'locale'] }
  }
  return populate
}

/** The targets a row populated with {@link referencePopulate} references through its fields. */
function referencesOf(
  row: Record<string, unknown>,
  fields: readonly ReferenceField[]
): { documentId?: unknown; locale?: unknown }[] {
  return fields.flatMap((field) => {
    const zone = row[field.zone]
    return Array.isArray(zone)
      ? zone.flatMap((item: Record<string, unknown>) =>
          item.__component === field.component ? targetsOf(item[field.attribute]) : []
        )
      : []
  })
}

/**
 * The `documentId`s of the reusable blocks a stored document of a referencing type references, in
 * any of its rows of `locale` (every row when omitted).
 */
export async function storedReferences(
  strapi: Core.Strapi,
  uid: string,
  fields: readonly ReferenceField[],
  target: { documentId: string; locale?: string }
): Promise<string[]> {
  const rows = (await strapi.db.query(uid as UID.ContentType).findMany({
    select: ['documentId'],
    where: { documentId: target.documentId, ...(target.locale ? { locale: target.locale } : {}) },
    populate: referencePopulate(fields),
  })) as Row[]
  const ids = rows.flatMap((row) => referencesOf(row, fields)).map((item) => item.documentId)
  return [...new Set(ids.filter((id): id is string => typeof id === 'string'))]
}

/**
 * The pages of the reusable block's site that reference it, in any locale, draft or published:
 * one entry per page and locale, sorted by title.
 *
 * @param target - The block's `documentId`, and with `locale` only the references to that locale
 * of the block; every one when omitted.
 */
export async function pagesUsing(
  strapi: Core.Strapi,
  target: { documentId: string; locale?: string }
): Promise<ReferencingPage[]> {
  const site = await siteOfReusableBlock(strapi, target.documentId)
  if (!site) return []
  const byType = new Map<string, ReferenceField[]>()
  for (const field of referenceFields(strapi)) {
    byType.set(field.uid, [...(byType.get(field.uid) ?? []), field])
  }
  const isTarget = (item: { documentId?: unknown; locale?: unknown }) =>
    item.documentId === target.documentId &&
    (target.locale === undefined || item.locale === target.locale)
  const pages = new Map<string, ReferencingPage>()
  for (const [uid, fields] of byType) {
    const documentIds = await documentsOfSite(strapi, uid, site)
    if (documentIds.length === 0) continue
    const names = Object.keys(strapi.contentType(uid as UID.ContentType).attributes)
    const rows = (await strapi.db.query(uid as UID.ContentType).findMany({
      select: [
        'documentId',
        'locale',
        'publishedAt',
        ...['title', 'slug'].filter((name) => names.includes(name)),
      ],
      where: { documentId: { $in: documentIds } },
      populate: referencePopulate(fields),
    })) as Row[]
    // A page is published when it has a published version in the locale: Strapi drops the link of
    // that version to a reusable block that was not published when the page was.
    const live = new Set(
      rows.filter((row) => row.publishedAt).map((row) => `${row.documentId}|${String(row.locale)}`)
    )
    for (const row of rows) {
      if (!referencesOf(row, fields).some(isTarget)) continue
      const locale = typeof row.locale === 'string' ? row.locale : null
      const key = `${uid}|${row.documentId}|${String(locale)}`
      if (pages.has(key) && row.publishedAt) continue
      pages.set(key, {
        uid,
        documentId: row.documentId,
        locale,
        // The draft's title when it references the block, else the published one's.
        title: String(row.title || row.slug || row.documentId),
        published: live.has(`${row.documentId}|${String(row.locale)}`),
      })
    }
  }
  return [...pages.values()].sort(
    (a, b) =>
      a.title.localeCompare(b.title) ||
      String(a.locale).localeCompare(String(b.locale)) ||
      a.uid.localeCompare(b.uid)
  )
}
