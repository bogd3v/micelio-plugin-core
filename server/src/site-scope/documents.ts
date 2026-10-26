import type { Core, Modules, UID } from '@strapi/strapi'
import { errors } from '@strapi/utils'
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
 * `disconnect`) does not touch it. Inside a scoped request, it also filters every read by the
 * request's site after Strapi has sanitised the query, gives a new entry the request's site and
 * keeps an updated one there whatever `site` the body names, and answers "not found" for a write
 * to another site's entry.
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
    return next()
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
