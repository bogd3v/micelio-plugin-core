import type { Core, Modules, UID } from '@strapi/strapi'
import { errors } from '@strapi/utils'
import { SITE_UID } from '../constants/site'
import { normalizeHosts } from '../site-scope/hosts'

type Params = Record<string, unknown> & { data?: Record<string, unknown>; documentId?: string }

const SITE = SITE_UID as UID.ContentType

/**
 * The document service middleware that keeps the sites consistent.
 *
 * @remarks
 * - `hosts` is a list of host names in lower case, and no two sites share one.
 * - Exactly one site is the default: making a site the default takes it from the previous one,
 *   and the default site can be neither unset nor deleted. Make another site the default first.
 */
export function siteRules(strapi: Core.Strapi): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    if (context.uid !== SITE) return next()
    const params = context.params as Params
    const documentId = context.action === 'create' ? undefined : params.documentId

    if (context.action === 'delete' && documentId && (await isDefaultSite(strapi, documentId))) {
      throw new errors.ValidationError('The default site cannot be deleted')
    }
    if (context.action !== 'create' && context.action !== 'update') return next()

    const data = params.data ?? {}
    if ('hosts' in data) {
      const hosts = normalizeHosts(data.hosts)
      if ('error' in hosts) throw new errors.ValidationError(hosts.error)
      const taken = await hostsOfOtherSites(strapi, documentId)
      const shared = hosts.find((host) => taken.has(host))
      if (shared) throw new errors.ValidationError(`Another site already has the host "${shared}"`)
      data.hosts = hosts
    }
    if (
      context.action === 'update' &&
      data.isDefault === false &&
      documentId &&
      (await isDefaultSite(strapi, documentId))
    ) {
      throw new errors.ValidationError('Make another site the default instead')
    }

    const result = await next()
    if (data.isDefault === true) {
      const saved = (result as { documentId?: string } | null)?.documentId ?? documentId
      await strapi.db.query(SITE).updateMany({
        where: { isDefault: true, documentId: { $ne: saved } },
        data: { isDefault: false },
      })
    }
    return result
  }
}

async function isDefaultSite(strapi: Core.Strapi, documentId: string): Promise<boolean> {
  return (await strapi.db.query(SITE).count({ where: { documentId, isDefault: true } })) > 0
}

async function hostsOfOtherSites(
  strapi: Core.Strapi,
  documentId: string | undefined
): Promise<Set<string>> {
  const rows = (await strapi.db.query(SITE).findMany({
    select: ['hosts'],
    where: documentId ? { documentId: { $ne: documentId } } : {},
  })) as { hosts: unknown }[]
  return new Set(rows.flatMap((row) => (Array.isArray(row.hosts) ? (row.hosts as string[]) : [])))
}
