import { SITE_UID } from '../constants/site'
import type { SiteSummary } from './resolve'

/** Name of the attribute that ties an entry to its site. */
export const SITE_ATTRIBUTE = 'site'

/**
 * Name of the route middleware that resolves the site of a content API request.
 *
 * @remarks
 * Add it to the `config.middlewares` of each content API route of a site-scoped type. It answers
 * `unknownSite` when the request names a site that does not exist, and otherwise scopes every read
 * and write of the request to its site.
 *
 * Give each action its own config object (a new literal or a call for every action), never one
 * object shared by several: Strapi writes a route's `auth.scope` into the config it is given, so a
 * shared object carries the scope of the first action onto the rest and a token that may only
 * `find` can also create, update and delete (`docs/api.md`).
 */
export const SITE_SCOPE_MIDDLEWARE = 'plugin::micelio.site-scope'

/** A content type schema as `withSiteScope` reads it. */
export interface ContentTypeSchema {
  attributes: Record<string, unknown>
  pluginOptions?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * The schema of a content type with the required relation to its site.
 *
 * @remarks
 * Every content type of a Micelio plugin is site-scoped (ADR-0017, section 4). The relation is
 * not localised: every locale of an entry belongs to the same site. An entry cannot be created
 * without a site; in a content API request scoped by {@link SITE_SCOPE_MIDDLEWARE} it gets the
 * request's site.
 *
 * @example
 * ```ts
 * import schema from './schema.json'
 * export default { schema: withSiteScope(schema) }
 * ```
 */
export function withSiteScope<T extends ContentTypeSchema>(schema: T): T {
  return {
    ...schema,
    pluginOptions: {
      ...schema.pluginOptions,
      micelio: { ...(schema.pluginOptions?.micelio as object | undefined), siteScoped: true },
    },
    attributes: {
      ...schema.attributes,
      [SITE_ATTRIBUTE]: {
        type: 'relation',
        relation: 'manyToOne',
        target: SITE_UID,
        required: true,
        pluginOptions: { i18n: { localized: false } },
      },
    },
  }
}

/** Whether a content type schema was made with {@link withSiteScope}. */
export function isSiteScoped(schema: { pluginOptions?: object } | undefined): boolean {
  const options = schema?.pluginOptions as { micelio?: { siteScoped?: unknown } } | undefined
  return options?.micelio?.siteScoped === true
}

/** Where the route middleware leaves the site of the request, in `ctx.state`. */
export interface SiteScopeState {
  micelio?: { site?: SiteSummary }
}
