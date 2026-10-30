import type { Core } from '@strapi/strapi'
import { BlockOptionError, BLOCK_OPTION_INVALID } from '../block-options/error'
import { SITE_UID } from '../constants/site'
import type { SiteScopeState } from '../site-scope'
import { pickSite, type SiteSummary } from '../site-scope/resolve'
import { sendProblem } from '../utils/problem'

const UNKNOWN_SITE_STATUS = 404
const BLOCK_OPTION_STATUS = 400

/**
 * Resolves the site of a content API request and leaves it in `ctx.state.micelio.site`.
 *
 * @remarks
 * The site comes from the `site` query parameter (a slug), then from the host, then is the
 * default one. The parameter is removed before Strapi validates the query. A slug that no site
 * has answers a problem detail with the code `unknownSite`. A save the catalogue refuses for an
 * option a block does not allow answers `blockOptionInvalid`, naming the block, the option and the
 * values it allows.
 */
const siteScope: Core.MiddlewareFactory = (_config, { strapi }) => {
  return async (ctx, next) => {
    const { site: slug, ...query } = ctx.query as Record<string, unknown>
    if (slug !== undefined) ctx.query = query
    const site = pickSite(await loadSites(strapi), {
      slug: slug === undefined ? undefined : String(slug),
      host: ctx.request.hostname,
    })
    if (!site) {
      sendProblem(ctx, {
        type: 'about:blank',
        title: 'Not Found',
        status: UNKNOWN_SITE_STATUS,
        detail:
          slug === undefined ? 'There is no default site.' : `There is no site "${String(slug)}".`,
        code: 'unknownSite',
      })
      return
    }
    const state = ctx.state as SiteScopeState
    state.micelio = { ...state.micelio, site }
    try {
      await next()
    } catch (error) {
      if (!(error instanceof BlockOptionError)) throw error
      const { block, option, allowed } = error.violation
      sendProblem(ctx, {
        type: 'about:blank',
        title: 'Bad Request',
        status: BLOCK_OPTION_STATUS,
        detail: error.message,
        code: BLOCK_OPTION_INVALID,
        block,
        option,
        allowed,
      })
    }
  }
}

export default siteScope

async function loadSites(strapi: Core.Strapi): Promise<SiteSummary[]> {
  // One row per locale; the fields read here are not localised.
  const rows = (await strapi.db.query(SITE_UID).findMany({
    select: ['documentId', 'slug', 'hosts', 'isDefault'],
  })) as { documentId: string; slug: string; hosts: unknown; isDefault: boolean }[]
  const sites = new Map<string, SiteSummary>()
  for (const row of rows) {
    sites.set(row.documentId, {
      documentId: row.documentId,
      slug: row.slug,
      hosts: Array.isArray(row.hosts) ? row.hosts.filter((host) => typeof host === 'string') : [],
      isDefault: row.isDefault,
    })
  }
  return [...sites.values()]
}
