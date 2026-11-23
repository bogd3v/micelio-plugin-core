import type { Core, Modules, UID } from '@strapi/strapi'
import { REUSABLE_BLOCK_UID, REUSABLE_BLOCKS_ATTRIBUTE } from '../constants/reusable-blocks'
import { SITE_ATTRIBUTE } from '../site-scope'
import { currentSite, namedSites } from '../site-scope/documents'
import { ReusableBlockError } from './error'
import { pagesUsing, referenceFields, reusableBlocksOfSite, storedReferences, targetsOf } from '.'
import { findReusableBlockViolation, referenceValuesIn, type ReferenceField } from './rules'

type Params = Record<string, unknown> & {
  data?: Record<string, unknown>
  documentId?: string
  locale?: string
}

/** The actions that write `data`; `clone` takes it too (the Content Manager's duplicate). */
const WRITE_ACTIONS: ReadonlySet<string> = new Set(['create', 'update', 'clone'])
const READ_ACTIONS: ReadonlySet<string> = new Set(['findMany', 'findFirst', 'findOne'])

/**
 * The document service middleware of the rules of the reusable blocks (ADR-0022, section 1).
 *
 * @remarks
 * - A save of a reusable block whose zone holds more than one block, a block that references a
 *   reusable block, or a block with a `group` key is refused (`reusableBlockInvalid`). Strapi's
 *   `min` refuses the publish of one with no block.
 * - A save of a page (an entry of a type found by `referenceFields`) that references a reusable
 *   block of another site is refused (`reusableBlockOtherSite`). The page's site is the one the
 *   save names, else the stored document's (the source's, for a clone). A save that names a site
 *   and none of the zones is checked against the references the page already stores.
 * - A delete of a reusable block that pages of its site reference, in the locale deleted, is
 *   refused with the pages (`reusableBlockInUse`).
 * - A read of a page in a content API request scoped to a site answers `null` for a populated
 *   reference to another site's reusable block: the content API never resolves it.
 *
 * @throws {@link ReusableBlockError}.
 */
export function reusableBlockDocuments(
  strapi: Core.Strapi
): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    const params = context.params as Params
    if (context.uid === REUSABLE_BLOCK_UID) {
      if (WRITE_ACTIONS.has(context.action)) assertBlockValid(strapi, params.data)
      if (context.action === 'delete' && params.documentId) {
        const locale = await deletedLocale(strapi, params.locale)
        const pages = await pagesUsing(strapi, { documentId: params.documentId, locale })
        if (pages.length > 0) throw ReusableBlockError.inUse(pages)
      }
      return next()
    }
    const fields = referenceFields(strapi).filter((field) => field.uid === context.uid)
    if (fields.length === 0) return next()
    if (WRITE_ACTIONS.has(context.action) && params.data) {
      await assertSameSite(strapi, context.uid, fields, params)
    }
    const result = await next()
    const site = READ_ACTIONS.has(context.action) ? currentSite(strapi) : undefined
    if (site) await dropOtherSites(strapi, fields, result, site.documentId)
    return result
  }
}

function assertBlockValid(strapi: Core.Strapi, data: Record<string, unknown> | undefined): void {
  const zone = data?.[REUSABLE_BLOCKS_ATTRIBUTE]
  if (!Array.isArray(zone)) return
  const components = new Set(referenceFields(strapi).map((field) => field.component))
  const isReference = (component: string) =>
    components.has(component) ||
    Object.values(strapi.components[component as UID.Component]?.attributes ?? {}).some(
      (attribute) => (attribute as { target?: string }).target === REUSABLE_BLOCK_UID
    )
  const violation = findReusableBlockViolation(zone, isReference)
  if (violation) throw ReusableBlockError.invalid(violation)
}

// A delete names one locale, every locale (`*`), or none: the default one.
async function deletedLocale(
  strapi: Core.Strapi,
  locale: string | undefined
): Promise<string | undefined> {
  if (locale === '*') return undefined
  if (locale) return locale
  const i18n = strapi.plugin('i18n')
  return i18n ? ((await i18n.service('locales').getDefaultLocale()) as string) : undefined
}

async function assertSameSite(
  strapi: Core.Strapi,
  uid: string,
  fields: ReferenceField[],
  params: Params
): Promise<void> {
  const references = new Map<string, string[]>()
  for (const field of fields) {
    references.set(field.component, [...(references.get(field.component) ?? []), field.attribute])
  }
  const zones = [...new Set(fields.map((field) => field.zone))]
  const values = zones.flatMap((zone) => {
    const value = params.data?.[zone]
    return Array.isArray(value) ? referenceValuesIn(value, references) : []
  })
  let named = (await Promise.all(values.map((value) => namedReusableBlocks(strapi, value)))).flat()
  // A move to another site that leaves the zones alone keeps the stored references: check those.
  const namesZone = zones.some((zone) => Array.isArray(params.data?.[zone]))
  if (!namesZone && params.documentId && params.data?.[SITE_ATTRIBUTE] !== undefined) {
    const locale = params.locale && params.locale !== '*' ? params.locale : undefined
    named = await storedReferences(strapi, uid, fields, { documentId: params.documentId, locale })
  }
  if (named.length === 0) return
  const site = await siteOfSave(strapi, uid, params)
  if (!site) return
  const own = await reusableBlocksOfSite(strapi, named, site)
  const other = named.find((documentId) => !own.has(documentId))
  if (other) throw ReusableBlockError.otherSite(other)
}

// The site a save belongs to: the one it names, else the one the stored document (or the source of
// a clone) has.
async function siteOfSave(
  strapi: Core.Strapi,
  uid: string,
  params: Params
): Promise<string | undefined> {
  const named = params.data?.[SITE_ATTRIBUTE]
  const [site] = named === undefined ? [] : await namedSites(strapi, named)
  if (site) return site
  if (!params.documentId) return undefined
  const rows = (await strapi.db.query(uid as UID.ContentType).findMany({
    where: { documentId: params.documentId },
    populate: { [SITE_ATTRIBUTE]: { select: ['documentId'] } },
  })) as { site?: { documentId: string } | null }[]
  return rows.find((row) => row.site)?.site?.documentId
}

/**
 * The `documentId`s of the reusable blocks a relation value connects: by `documentId` or `id`, bare,
 * in a list, or in `connect` or `set`.
 */
async function namedReusableBlocks(strapi: Core.Strapi, value: unknown): Promise<string[]> {
  if (typeof value === 'string') return [value]
  if (typeof value === 'number') {
    const row = (await strapi.db
      .query(REUSABLE_BLOCK_UID as UID.ContentType)
      .findOne({ select: ['documentId'], where: { id: value } })) as { documentId: string } | null
    return row ? [row.documentId] : []
  }
  if (Array.isArray(value)) {
    return (await Promise.all(value.map((item) => namedReusableBlocks(strapi, item)))).flat()
  }
  if (typeof value !== 'object' || value === null) return []
  const { documentId, id, connect, set } = value as Record<string, unknown>
  if (typeof documentId === 'string') return [documentId]
  if (typeof id === 'number') return namedReusableBlocks(strapi, id)
  return [
    ...(await namedReusableBlocks(strapi, connect)),
    ...(await namedReusableBlocks(strapi, set)),
  ]
}

// Replaces each populated reference to a reusable block of another site with `null`.
async function dropOtherSites(
  strapi: Core.Strapi,
  fields: ReferenceField[],
  result: unknown,
  site: string
): Promise<void> {
  const entries = (Array.isArray(result) ? result : [result]).filter(
    (entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object'
  )
  const found: { item: Record<string, unknown>; attribute: string; documentId: string }[] = []
  for (const entry of entries) {
    for (const field of fields) {
      const zone = entry[field.zone]
      if (!Array.isArray(zone)) continue
      for (const item of zone as Record<string, unknown>[]) {
        if (item?.__component !== field.component) continue
        for (const target of targetsOf(item[field.attribute])) {
          if (typeof target.documentId === 'string') {
            found.push({ item, attribute: field.attribute, documentId: target.documentId })
          }
        }
      }
    }
  }
  if (found.length === 0) return
  const own = await reusableBlocksOfSite(
    strapi,
    found.map((reference) => reference.documentId),
    site
  )
  for (const { item, attribute, documentId } of found) {
    if (own.has(documentId)) continue
    const value = item[attribute]
    item[attribute] = Array.isArray(value)
      ? value.filter((target: { documentId?: unknown }) => target?.documentId !== documentId)
      : null
  }
}
