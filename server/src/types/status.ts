import type { HostCheckReport } from './host-check'

/** What `GET /micelio/status` answers: the operator's view of the installation (issue #8). */
export interface StatusReport {
  plugin: StatusPlugin
  sites: StatusSite[]
  /** One entry per distinct origin of the sites' `url`, in order; empty when no site has one. */
  frontends: StatusFrontend[]
  /** The latest run of the host check; `null` when it has not run since the boot. */
  hostCheck: HostCheckReport | null
  blocks: StatusBlocks
}

/** The plugin package. */
export interface StatusPlugin {
  /** The `version` of `@micelio/strapi-plugin-core`. */
  version: string
  /** The core release line it supports, `micelio` in its `package.json` (standard, section 7). */
  coreLine: string
}

/** One site, in Strapi's default locale when it has one. */
export interface StatusSite {
  documentId: string
  name: string
  slug: string
  /** Host names the site answers to, in lower case. */
  hosts: string[]
  isDefault: boolean
  /** The origin of the site's `url`; `null` when it has none. */
  origin: string | null
}

/**
 * What a frontend answered on `GET <origin>/_health`.
 *
 * @remarks
 * `unavailable` is not an error: the frontend may not serve the endpoint yet (bogd3v/micelio#702)
 * or may be down; the page says which origin did not answer.
 */
export interface StatusFrontend {
  origin: string
  /** Slugs of the sites whose `url` has this origin. */
  sites: string[]
  health: 'reachable' | 'unavailable'
  /** The `version` of its answer, when it gave one. */
  version?: string
}

/** The block catalogue the plugin serves (ADR-0018). */
export interface StatusBlocks {
  /** Number of blocks in the catalogue. */
  count: number
}
