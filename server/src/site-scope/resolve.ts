/** What site resolution needs of a site. */
export interface SiteSummary {
  documentId: string
  slug: string
  hosts: string[]
  isDefault: boolean
}

/** What a request says about its site. */
export interface SiteRequest {
  /** The `site` query parameter: a site's slug. */
  slug?: string
  /** The host name the request was made to, without the port. */
  host?: string
}

/**
 * The site a request names, or `undefined` when it names one that does not exist.
 *
 * @remarks
 * A slug wins over the host. A host that no site lists is not an error: the default site answers,
 * which keeps a frontend that calls the CMS by its own host name working unchanged (ADR-0017,
 * section 4). Without a default site, a request that names none resolves to `undefined` too.
 */
export function pickSite(sites: SiteSummary[], request: SiteRequest): SiteSummary | undefined {
  if (request.slug !== undefined) return sites.find((site) => site.slug === request.slug)
  const host = request.host?.toLowerCase()
  const byHost = host ? sites.find((site) => site.hosts.includes(host)) : undefined
  return byHost ?? sites.find((site) => site.isDefault)
}
