import type { Core } from '@strapi/strapi'
import packageJson from '../../../package.json'
import { BLOCKS } from '../../../contract/blocks'
import { SITE_UID } from '../constants/site'
import { readFrontend } from '../host-check/facts'
import type { HostCheckReport } from '../types/host-check'
import type { StatusFrontend, StatusReport, StatusSite } from '../types/status'

interface SiteRow {
  documentId: string
  locale: string | null
  name: string | null
  slug: string
  hosts: unknown
  isDefault: boolean | null
  url: string | null
}

/**
 * Gathers what the status page shows.
 *
 * @remarks
 * The host check is the latest run (`hostCheck.latest()`), not a new one. The frontends are asked
 * for `/_health` on every call, at most two seconds each and in parallel: at boot they are usually
 * not up yet, so the boot's answer would be stale.
 */
export async function readStatus(strapi: Core.Strapi): Promise<StatusReport> {
  const sites = await readSites(strapi)
  const latest = strapi.plugin('micelio').service('hostCheck').latest() as
    HostCheckReport | undefined
  return {
    plugin: { version: packageJson.version, coreLine: packageJson.micelio },
    sites,
    frontends: await readFrontends(sites),
    hostCheck: latest ?? null,
    blocks: { count: BLOCKS.length },
  }
}

/** One entry per site, in the default locale when the site has it, the default site first. */
async function readSites(strapi: Core.Strapi): Promise<StatusSite[]> {
  const locales = strapi.plugin('i18n').service('locales') as {
    getDefaultLocale: () => Promise<string>
  }
  const defaultLocale = await locales.getDefaultLocale()
  const rows = (await strapi.db.query(SITE_UID).findMany({
    select: ['documentId', 'locale', 'name', 'slug', 'hosts', 'isDefault', 'url'],
    orderBy: { slug: 'asc' },
  })) as SiteRow[]
  const byDocument = new Map<string, SiteRow>()
  for (const row of rows) {
    const kept = byDocument.get(row.documentId)
    if (!kept || (kept.locale !== defaultLocale && row.locale === defaultLocale)) {
      byDocument.set(row.documentId, row)
    }
  }
  const sites = [...byDocument.values()].map(toSite)
  return [...sites.filter((site) => site.isDefault), ...sites.filter((site) => !site.isDefault)]
}

function toSite(row: SiteRow): StatusSite {
  return {
    documentId: row.documentId,
    name: row.name ?? row.slug,
    slug: row.slug,
    hosts: Array.isArray(row.hosts) ? row.hosts.filter((host) => typeof host === 'string') : [],
    isDefault: row.isDefault === true,
    origin: originOf(row.url),
  }
}

function originOf(url: string | null): string | null {
  if (!url) return null
  try {
    // Only the origin: a `url` could carry credentials, a path or a query.
    return new URL(url).origin
  } catch {
    // The site's regex refuses such a value; a row that has one shows no origin.
    return null
  }
}

async function readFrontends(sites: StatusSite[]): Promise<StatusFrontend[]> {
  const slugsByOrigin = new Map<string, string[]>()
  for (const { origin, slug } of sites) {
    if (origin) slugsByOrigin.set(origin, [...(slugsByOrigin.get(origin) ?? []), slug])
  }
  const origins = [...slugsByOrigin.keys()].sort()
  return Promise.all(
    origins.map(async (origin) => {
      const { reachable, version } = await readFrontend(origin)
      return {
        origin,
        sites: slugsByOrigin.get(origin) ?? [],
        health: reachable ? 'reachable' : 'unavailable',
        ...(version ? { version } : {}),
      } satisfies StatusFrontend
    })
  )
}
