import { createRequire } from 'node:module'
import path from 'node:path'
import type { Core } from '@strapi/strapi'
import packageJson from '../../../package.json'
import { SITE_UID } from '../constants/site'
import { SANITISERS, type FrontendFacts, type HostFacts } from './checks'

type MiddlewareEntry = string | { name?: string; config?: Record<string, unknown> }

// A health answer that takes longer than this counts as unreachable: the check runs at boot.
const FRONTEND_TIMEOUT_MS = 2000

// HTML a sanitiser must defuse to pass the probe.
const SANITISER_PROBE = '<p>ok</p><img src="x" onerror="alert(1)"><script>alert(1)</script>'

/**
 * Reads what the host check needs from the running host.
 *
 * @remarks
 * Call it in `bootstrap` or later: it reads the sites from the database. It asks each site's
 * frontend for `/_health`, at most two seconds each, and keeps only origins, never full URLs.
 */
export async function readHostFacts(strapi: Core.Strapi): Promise<HostFacts> {
  const middlewares = strapi.config.get<MiddlewareEntry[]>('middlewares', [])
  const siteOrigins = await readSiteOrigins(strapi)
  return {
    environment: strapi.config.get<string>('environment', process.env.NODE_ENV ?? 'development'),
    nodeVersion: process.versions.node,
    engines: packageJson.engines.node,
    coreLine: packageJson.micelio,
    databaseClient: strapi.config.get<string>('database.connection.client', 'unknown'),
    middlewares: middlewares.map(middlewareName),
    csp: readCsp(middlewares),
    uploadProvider: readUploadProvider(strapi),
    sanitiser: probeSanitisers(strapi.dirs.app.root),
    siteOrigins,
    frontends: await Promise.all(siteOrigins.map(readFrontend)),
  }
}

function middlewareName(entry: MiddlewareEntry): string {
  return typeof entry === 'string' ? entry : (entry.name ?? '')
}

/** The admin's CSP directives, as helmet would build them from the `strapi::security` config. */
function readCsp(middlewares: MiddlewareEntry[]): Record<string, string[]> | false {
  const security = middlewares.find((entry) => middlewareName(entry) === 'strapi::security')
  if (!security) return false
  const config = typeof security === 'string' ? undefined : security.config
  const csp = config?.contentSecurityPolicy as
    false | { useDefaults?: boolean; directives?: Record<string, unknown> } | undefined
  if (csp === false) return false
  // Strapi turns on helmet's defaults, whose `default-src` is `'self'`.
  const directives: Record<string, string[]> =
    csp?.useDefaults === false ? {} : { 'default-src': ["'self'"] }
  for (const [name, value] of Object.entries(csp?.directives ?? {})) {
    const key = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    if (value === null) delete directives[key]
    else if (Array.isArray(value)) directives[key] = value.map(String)
    else if (typeof value === 'string') directives[key] = value.split(/\s+/)
  }
  return directives
}

function readUploadProvider(strapi: Core.Strapi): string | undefined {
  const upload = strapi.plugin('upload') as { provider?: Record<string, unknown> } | undefined
  const provider = upload?.provider
  if (!provider || typeof provider.delete !== 'function') return undefined
  if (typeof provider.upload !== 'function' && typeof provider.uploadStream !== 'function') {
    return undefined
  }
  // Only the name: the options hold credentials.
  return strapi.config.get<string>('plugin::upload.provider', 'local')
}

/** The first sanitiser the host can load that strips a script and an event handler. */
function probeSanitisers(appRoot: string): string | undefined {
  const requireFromHost = createRequire(path.join(appRoot, 'package.json'))
  for (const name of SANITISERS) {
    let output: unknown
    try {
      const loaded = requireFromHost(name) as unknown
      output = runSanitiser(loaded, SANITISER_PROBE)
    } catch {
      // Not installed in the host, or it threw on the probe: try the next one.
      continue
    }
    if (typeof output === 'string' && output.includes('ok') && !/<script|onerror/i.test(output)) {
      return name
    }
  }
  return undefined
}

function runSanitiser(loaded: unknown, html: string): unknown {
  // sanitize-html exports a function; isomorphic-dompurify an object with `sanitize`.
  if (typeof loaded === 'function') return (loaded as (input: string) => unknown)(html)
  const sanitize = (loaded as { sanitize?: unknown } | null)?.sanitize
  if (typeof sanitize === 'function') return (sanitize as (input: string) => unknown)(html)
  return undefined
}

async function readSiteOrigins(strapi: Core.Strapi): Promise<string[]> {
  const sites = (await strapi.db.query(SITE_UID).findMany({ select: ['url'] })) as {
    url?: string | null
  }[]
  const origins = new Set<string>()
  for (const { url } of sites) {
    if (!url) continue
    try {
      // The origin drops any credentials, path and query.
      origins.add(new URL(url).origin)
    } catch {
      // The site's own regex refuses such a value; a row that has one is skipped, not fatal.
    }
  }
  return [...origins].sort()
}

async function readFrontend(origin: string): Promise<FrontendFacts> {
  try {
    const response = await fetch(`${origin}/_health`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FRONTEND_TIMEOUT_MS),
    })
    if (!response.ok) return { origin, reachable: false }
    let version: unknown
    try {
      version = ((await response.json()) as { version?: unknown } | null)?.version
    } catch {
      // A health answer without a JSON body: reachable, with no version to compare.
    }
    return { origin, reachable: true, version: typeof version === 'string' ? version : undefined }
  } catch {
    // Refused, timed out or not resolvable: the check reports it as not reachable.
    return { origin, reachable: false }
  }
}
