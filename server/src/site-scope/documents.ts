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
 * plugins) it only refuses to create an entry without a site or to remove its site. Inside one,
 * it also filters every read by the request's site after Strapi has sanitised the query, gives a
 * new entry the request's site, and answers "not found" for a write to another site's entry.
 */
export function siteScopeDocuments(strapi: Core.Strapi): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    if (!isSiteScoped(strapi.contentType(context.uid))) return next()
    const params = context.params as Params
    const site = currentSite(strapi)

    if (context.action === 'create') {
      params.data = params.data ?? {}
      if (isMissing(params.data[SITE_ATTRIBUTE])) {
        if (!site) throw new errors.ValidationError(`${SITE_ATTRIBUTE} is required`)
        params.data[SITE_ATTRIBUTE] = site.documentId
      }
    }
    if (context.action === 'update' && params.data && SITE_ATTRIBUTE in params.data) {
      if (isMissing(params.data[SITE_ATTRIBUTE])) {
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

// A relation value that connects nothing: absent, null, or an empty `connect` or `set`.
function isMissing(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') {
    const { connect, set } = value as { connect?: unknown; set?: unknown }
    const list = set ?? connect
    return Array.isArray(list) ? list.length === 0 : list === undefined
  }
  return false
}
