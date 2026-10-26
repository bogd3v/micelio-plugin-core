import type { Core, Modules, UID } from '@strapi/strapi'
import { errors } from '@strapi/utils'
import { SITE_UID } from '../constants/site'
import { isSiteScoped, SITE_ATTRIBUTE, type SiteScopeState } from '.'
import type { SiteSummary } from './resolve'

type Params = Record<string, unknown> & { data?: Record<string, unknown>; documentId?: string }

const READ_ACTIONS = new Set(['findMany', 'findFirst', 'findOne', 'count'])
const WRITE_ACTIONS = new Set(['update', 'delete', 'publish', 'unpublish', 'discardDraft'])

/**
 * The document service middleware that keeps site-scoped entries in their site.
 *
 * @remarks
 * Outside a request scoped by the `site-scope` route middleware (the admin, boot steps, other
 * plugins) it only refuses to create an entry without a site or to remove its site. An update
 * whose `site` leaves the relation as it is (the Content Manager sends empty `connect` and
 * `disconnect`) does not touch it. An update that adds a locale to an entry gives it the site of
 * the entry's other locales, because Strapi's i18n does not copy a relation, and is refused with
 * "site is required" when those rows name different sites or none and the update names none, or with
 * "site must be the site of the other locales" when it names another one. An update may change the
 * site of an existing locale only when no other locale of the entry stays on another site, and is
 * refused otherwise ("site cannot change while other locales of the document stay on another
 * site"); an entry of a single locale moves freely. Inside a scoped request, it also filters every read by the
 * request's site after Strapi has sanitised the query, gives a new entry the request's site and
 * keeps an updated one there whatever `site` the body names, and answers "not found" for a write
 * to another site's entry, before anything else is read. Publishing or discarding the draft of a
 * locale keeps its site on the row Strapi rebuilds.
 */
export function siteScopeDocuments(strapi: Core.Strapi): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    if (!isSiteScoped(strapi.contentType(context.uid))) return next()
    const params = context.params as Params
    const site = currentSite(strapi)

    if (context.action === 'create') {
      params.data = params.data ?? {}
      // A scoped request creates in its own site, whatever `site` the body names.
      if (site) params.data[SITE_ATTRIBUTE] = site.documentId
      else if (isMissing(params.data[SITE_ATTRIBUTE])) {
        throw new errors.ValidationError(`${SITE_ATTRIBUTE} is required`)
      }
    }
    if (context.action === 'update' && params.data && SITE_ATTRIBUTE in params.data) {
      // A scoped request writes only entries of its site and keeps them there.
      if (site) delete params.data[SITE_ATTRIBUTE]
      // The Content Manager sends an untouched relation as empty `connect` and `disconnect`.
      else if (isUnchanged(params.data[SITE_ATTRIBUTE])) delete params.data[SITE_ATTRIBUTE]
      else if (isMissing(params.data[SITE_ATTRIBUTE])) {
        throw new errors.ValidationError(`${SITE_ATTRIBUTE} is required`)
      }
    }
    if (site && READ_ACTIONS.has(context.action)) {
      params.filters = { $and: [params.filters ?? {}, siteFilter(site)] }
    }
    if (site && WRITE_ACTIONS.has(context.action) && params.documentId) {
      const owned = await strapi.db.query(context.uid as UID.ContentType).count({
        where: { documentId: params.documentId, ...siteFilter(site) },
      })
      if (owned === 0) throw new errors.NotFoundError('Not Found')
    }
    // After the ownership check: a request scoped to another site learns nothing of the document.
    if (context.action === 'update' && params.documentId) {
      await keepSiteOfLocales(strapi, context.uid as UID.ContentType, params)
    }
    const result = await next()
    if (rebuildsRelations(context.action, params) && params.documentId) {
      await repairSiteOfLocales(strapi, context.uid as UID.ContentType, params)
    }
    return result
  }
}

// What an update of a localised document may do to its site, so that its locales stay together.
// A locale that does not exist yet takes the site of the document's rows, as a relation by entry id
// (the site type is localised, so a `documentId` would be looked up in the new row's locale), and a
// `site` the update names must be that site: it throws when the rows name more than one site, or
// none, and the update names none, or when it names another one. A locale that exists may change
// its site only when no other locale of the document stays on another site. Does nothing when the
// document has no row.
async function keepSiteOfLocales(
  strapi: Core.Strapi,
  uid: UID.ContentType,
  params: Params
): Promise<void> {
  if (!isLocalized(strapi, uid)) return
  const locale =
    typeof params.locale === 'string'
      ? params.locale
      : ((await strapi.plugin('i18n').service('locales').getDefaultLocale()) as string)
  const { documentId } = params
  const rows = (await strapi.db.query(uid).findMany({
    where: { documentId },
    populate: { [SITE_ATTRIBUTE]: { select: ['id', 'documentId'] } },
  })) as { locale: string | null; site?: { id: number; documentId: string } | null }[]
  // No row at all: the document does not exist, and Strapi answers that.
  if (rows.length === 0) return
  const named = params.data?.[SITE_ATTRIBUTE]
  if (rows.some((row) => row.locale === locale)) {
    if (named !== undefined) await refuseMoveAwayFromOtherLocales(strapi, rows, locale, named)
    return
  }
  const sites = new Map(
    rows.flatMap((row) => (row.site ? [[row.site.documentId, row.site.id]] : []))
  )
  const data = (params.data = params.data ?? {})
  if (named !== undefined) {
    // A document with no site, or with several, takes the one the update names.
    if (sites.size !== 1) return
    const [[shared]] = [...sites]
    for (const documentIdOfNamed of await namedSites(strapi, named)) {
      if (documentIdOfNamed !== shared) {
        throw new errors.ValidationError(`${SITE_ATTRIBUTE} must be the site of the other locales`)
      }
    }
  } else if (sites.size !== 1) {
    throw new errors.ValidationError(`${SITE_ATTRIBUTE} is required`)
  }
  data[SITE_ATTRIBUTE] = { connect: [{ id: [...sites.values()][0]! }] }
}

// Refuses a move of the site of one locale while another locale of the document stays on another
// site. A site the locale already has, or that every other locale already has, is not a refusal; a
// document of a single locale moves freely (#45).
async function refuseMoveAwayFromOtherLocales(
  strapi: Core.Strapi,
  rows: { locale: string | null; site?: { documentId: string } | null }[],
  locale: string,
  named: unknown
): Promise<void> {
  const target = new Set(await namedSites(strapi, named))
  const own = rows
    .filter((row) => row.locale === locale)
    .flatMap((row) => row.site?.documentId ?? [])
  if (target.size === 0 || [...target].every((site) => own.includes(site))) return
  const staysElsewhere = rows.some(
    (row) => row.locale !== locale && row.site && !target.has(row.site.documentId)
  )
  if (staysElsewhere) {
    throw new errors.ValidationError(
      `${SITE_ATTRIBUTE} cannot change while other locales of the document stay on another site`
    )
  }
}

// The documentIds of the sites a relation value connects: it may name them by `documentId` or `id`,
// bare, in a list, or in `connect` or `set`.
async function namedSites(strapi: Core.Strapi, value: unknown): Promise<string[]> {
  if (typeof value === 'string') return [value]
  if (typeof value === 'number') return [await documentIdOfSite(strapi, value)]
  if (Array.isArray(value))
    return (await Promise.all(value.map((v) => namedSites(strapi, v)))).flat()
  if (typeof value !== 'object' || value === null) return []
  const { documentId, id, connect, set } = value as Record<string, unknown>
  if (typeof documentId === 'string') return [documentId]
  if (typeof id === 'number') return [await documentIdOfSite(strapi, id)]
  return [...(await namedSites(strapi, connect)), ...(await namedSites(strapi, set))]
}

async function documentIdOfSite(strapi: Core.Strapi, id: number): Promise<string> {
  const row = (await strapi.db.query(SITE_UID).findOne({ where: { id } })) as {
    documentId: string
  } | null
  return row?.documentId ?? String(id)
}

function isLocalized(strapi: Core.Strapi, uid: string): boolean {
  const model = strapi.contentType(uid as UID.ContentType)
  const options = model.pluginOptions as { i18n?: { localized?: boolean } } | undefined
  return options?.i18n?.localized === true
}

// The actions that rebuild a row from the relations of another version of the same locale: publish
// and discardDraft, and an update that publishes. Strapi clones the relations in the row's own
// locale, and the site type is localised. `unpublish` only deletes, `create` and a plain `update`
// write the relations the caller sent, and `clone` connects its relations by entry id.
function rebuildsRelations(action: string, params: Params): boolean {
  return (
    action === 'publish' ||
    action === 'discardDraft' ||
    (action === 'update' && params.status === 'published')
  )
}

// A site with no row in the locale of the page is dropped when Strapi clones the relations of one
// version into the other, so the new row has no site. A row with no site takes the site of the
// other version of its locale. It runs after Strapi's own transaction: a failed repair leaves the
// row without a site, which no content API read serves.
async function repairSiteOfLocales(
  strapi: Core.Strapi,
  uid: UID.ContentType,
  params: Params
): Promise<void> {
  if (!isLocalized(strapi, uid)) return
  const query = strapi.db.query(uid)
  const rows = (await query.findMany({
    where: {
      documentId: params.documentId,
      ...(typeof params.locale === 'string' && params.locale !== '*'
        ? { locale: params.locale }
        : {}),
    },
    populate: { [SITE_ATTRIBUTE]: { select: ['id'] } },
  })) as {
    id: number
    locale: string | null
    publishedAt: string | null
    site?: { id: number } | null
  }[]
  for (const row of rows.filter((candidate) => !candidate.site)) {
    const other = rows.find((candidate) => candidate.locale === row.locale && candidate.site)
    if (other?.site) {
      await query.update({ where: { id: row.id }, data: { [SITE_ATTRIBUTE]: other.site.id } })
    }
  }
}

function currentSite(strapi: Core.Strapi): SiteSummary | undefined {
  const state = strapi.requestContext.get()?.state as SiteScopeState | undefined
  return state?.micelio?.site
}

function siteFilter(site: SiteSummary): Record<string, unknown> {
  return { [SITE_ATTRIBUTE]: { documentId: { $eq: site.documentId } } }
}

// A relation value that changes nothing: an object whose only keys are `connect` and `disconnect`,
// both empty or absent. Any other shape (`{ documentId }`, `{ id }`, `set`, a string) is a value.
function isUnchanged(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { connect, disconnect, ...rest } = value as Record<string, unknown>
  const isEmpty = (list: unknown) =>
    list === undefined || (Array.isArray(list) && list.length === 0)
  return Object.keys(rest).length === 0 && isEmpty(connect) && isEmpty(disconnect)
}

// A relation value that connects nothing: absent, null, an empty list, an empty `connect` or `set`,
// or a longhand `{ documentId }` or `{ id }` that is empty.
function isMissing(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') {
    const { connect, set, documentId, id } = value as Record<string, unknown>
    if (documentId !== undefined || id !== undefined) return !(documentId || id)
    const list = set ?? connect
    return Array.isArray(list) ? list.length === 0 : list === undefined
  }
  return false
}
