/** What `GET /micelio/about` answers: the versions of the installation and the text "Copy diagnostics" copies. */
export interface AboutReport {
  plugin: { version: string; coreLine: string }
  strapi: { version: string; node: string }
  /** The database engine and its version, such as `postgres 16.4`. */
  database: string
  /** The uploads provider's name, such as `local`. */
  uploads: string
  /** Whether an email provider other than Strapi's default `sendmail` is set. */
  isSmtpConfigured: boolean
  /** The frontends of the sites, from the last check; empty when no site has a `url`. */
  frontends: AboutFrontend[]
  /** The `@micelio/*` plugins installed next to the core, by package name. */
  siblings: { name: string; version: string }[]
  update: AboutUpdate
  /** When the frontends and the release feed were last checked; `null` before the first check. */
  checkedAt: string | null
  /** Versions, modes and counts, nothing else (`docs/operate/about-page.md`). */
  diagnostics: string
}

/** A frontend as the last daily check found it. */
export interface AboutFrontend {
  origin: string
  /** The slugs of the sites whose `url` has this origin. */
  sites: string[]
  health: 'reachable' | 'unavailable'
  version?: string
  /** How long `GET /_health` took, in milliseconds. */
  ms?: number
}

/** The release feed's answer, or why there is none. */
export type AboutUpdate =
  /** `MICELIO_UPDATE_CHECK=false`: nothing was asked. */
  | { state: 'off' }
  /** The feed has not been read yet, or did not answer. */
  | { state: 'unknown' }
  | { state: 'current' }
  | { state: 'available'; version: string; url: string }
