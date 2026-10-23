import type { HostCheckResult } from '../types/host-check'

/** What the host check reads from the running host, gathered by `readHostFacts`. */
export interface HostFacts {
  environment: string
  nodeVersion: string
  /** The plugin's `engines.node`. */
  engines: string
  /** The core release line the plugin supports, `micelio` in its `package.json`. */
  coreLine: string
  databaseClient: string
  /** Names of the middlewares in `config/middlewares`, in order. */
  middlewares: string[]
  /** The admin's CSP directives as `strapi::security` sets them; `false` when it sets none. */
  csp: Record<string, string[]> | false
  /** Name of the uploads provider, when one is loaded. */
  uploadProvider?: string
  /** Name of the module that passed the sanitiser probe, when one did. */
  sanitiser?: string
  /** Origins of the sites' `url`. */
  siteOrigins: string[]
  /** What each site origin answered on `/_health`. */
  frontends: FrontendFacts[]
}

/** What a frontend answered on its health endpoint. */
export interface FrontendFacts {
  origin: string
  reachable: boolean
  /** The `version` of its answer, when it gave one. */
  version?: string
}

/** Middlewares a host keeps for Micelio: error masking, the security headers and CORS. */
export const SECURITY_MIDDLEWARES = ['strapi::errors', 'strapi::security', 'strapi::cors']

/** Server-side sanitisers the check accepts, in the order it tries them. */
export const SANITISERS = ['sanitize-html', 'isomorphic-dompurify']

// One comparator of an `engines` range: an operator and a version whose parts may be `x` or `*`.
const COMPARATOR = /^(>=|<=|>|<|=)?v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/

/** Runs every check of ADR-0017 section 7 and ADR-0019 section 5 against the facts. */
export function evaluateHostChecks(facts: HostFacts): HostCheckResult[] {
  return [
    checkNode(facts),
    checkDatabase(facts),
    checkSecurityMiddlewares(facts),
    checkContentSecurityPolicy(facts),
    checkSanitiser(facts),
    checkUploadProvider(facts),
    checkFrontendLine(facts),
    checkPreviewFrameSrc(facts),
  ]
}

/**
 * Whether a Node version satisfies an `engines` range of space-separated comparators.
 *
 * @returns `undefined` when the version or the range cannot be read.
 */
export function satisfiesEngines(version: string, range: string): boolean | undefined {
  const current = parseVersion(version)
  if (!current) return undefined
  let satisfied = true
  for (const comparator of range.trim().split(/\s+/)) {
    const match = COMPARATOR.exec(comparator)
    if (!match) return undefined
    const [, operator = '=', major, minor, patch] = match
    // A partial version is a range: `24.x` (or `24`) is every 24, `22.12` every 22.12.
    const isWildMinor = minor === undefined || minor === 'x' || minor === '*'
    const isWildPatch = isWildMinor || patch === undefined || patch === 'x' || patch === '*'
    const lower = [Number(major), isWildMinor ? 0 : Number(minor), isWildPatch ? 0 : Number(patch)]
    const upper = isWildMinor
      ? [lower[0] + 1, 0, 0]
      : isWildPatch
        ? [lower[0], lower[1] + 1, 0]
        : [lower[0], lower[1], lower[2] + 1]
    const isAboveLower = compareVersions(current, lower) >= 0
    const isBelowUpper = compareVersions(current, upper) < 0
    if (operator === '>=') satisfied &&= isAboveLower
    else if (operator === '>') satisfied &&= !isBelowUpper
    else if (operator === '<') satisfied &&= !isAboveLower
    else if (operator === '<=') satisfied &&= isBelowUpper
    else satisfied &&= isAboveLower && isBelowUpper
  }
  return satisfied
}

/**
 * Whether a frontend of one release line works with a core of another.
 *
 * @remarks
 * The CMS of a release line also serves the frontend of the previous MINOR (standard, section 7).
 */
export function isCompatibleLine(frontendLine: string, coreLine: string): boolean {
  const frontend = parseVersion(frontendLine)
  const core = parseVersion(coreLine)
  if (!frontend || !core) return false
  return frontend[0] === core[0] && (frontend[1] === core[1] || frontend[1] === core[1] - 1)
}

function checkNode({ nodeVersion, engines }: HostFacts): HostCheckResult {
  const base = { id: 'node', title: 'Node version', required: true }
  const satisfied = satisfiesEngines(nodeVersion, engines)
  if (satisfied) return { ...base, status: 'pass', detail: `Node ${nodeVersion}` }
  return {
    ...base,
    status: 'fail',
    detail: `Node ${nodeVersion} is outside the plugin's engines (${engines}).`,
    fix: `Run a Node version that satisfies ${engines}.`,
  }
}

function checkDatabase({ environment, databaseClient }: HostFacts): HostCheckResult {
  const base = { id: 'database', title: 'PostgreSQL in production', required: true }
  if (environment !== 'production') {
    return { ...base, status: 'skip', detail: `${databaseClient}, outside production.` }
  }
  if (databaseClient === 'postgres') return { ...base, status: 'pass', detail: 'postgres' }
  return {
    ...base,
    status: 'fail',
    detail: `The database client is ${databaseClient}.`,
    fix: 'Set the client of config/database to postgres.',
  }
}

function checkSecurityMiddlewares({ middlewares }: HostFacts): HostCheckResult {
  const base = { id: 'security-middlewares', title: 'Security middlewares', required: true }
  const missing = SECURITY_MIDDLEWARES.filter((name) => !middlewares.includes(name))
  if (missing.length === 0) {
    return { ...base, status: 'pass', detail: SECURITY_MIDDLEWARES.join(', ') }
  }
  return {
    ...base,
    status: 'fail',
    detail: `config/middlewares lacks ${missing.join(', ')}.`,
    fix: `Add ${missing.join(', ')} to config/middlewares.`,
  }
}

function checkContentSecurityPolicy({ csp }: HostFacts): HostCheckResult {
  const base = { id: 'content-security-policy', title: 'Content Security Policy', required: true }
  if (csp) return { ...base, status: 'pass', detail: 'strapi::security sets a CSP.' }
  return {
    ...base,
    status: 'fail',
    detail: 'strapi::security sets no Content Security Policy.',
    fix: 'Keep strapi::security in config/middlewares and do not set contentSecurityPolicy to false.',
  }
}

function checkSanitiser({ sanitiser }: HostFacts): HostCheckResult {
  const base = { id: 'html-sanitiser', title: 'Sanitiser for HTML from content', required: true }
  if (sanitiser) return { ...base, status: 'pass', detail: sanitiser }
  return {
    ...base,
    status: 'fail',
    detail: `None of ${SANITISERS.join(', ')} loads from the host and strips a script.`,
    fix: 'Install sanitize-html in the Strapi project.',
  }
}

function checkUploadProvider({ uploadProvider }: HostFacts): HostCheckResult {
  const base = { id: 'upload-provider', title: 'Uploads provider', required: true }
  if (uploadProvider) return { ...base, status: 'pass', detail: uploadProvider }
  return {
    ...base,
    status: 'fail',
    detail: 'The upload plugin has no provider loaded.',
    fix: 'Enable the upload plugin and set its provider in config/plugins.',
  }
}

function checkFrontendLine({ frontends, coreLine }: HostFacts): HostCheckResult {
  const base = { id: 'frontend-release-line', title: 'Frontend release line', required: false }
  if (frontends.length === 0) {
    return { ...base, status: 'skip', detail: 'No site has a url.' }
  }
  const findings = frontends.map(({ origin, reachable, version }) => {
    if (!reachable) return { origin, status: 'skip', text: `${origin} is not reachable` }
    if (!version) return { origin, status: 'skip', text: `${origin} reports no version` }
    const isCompatible = isCompatibleLine(version, coreLine)
    return { origin, status: isCompatible ? 'pass' : 'fail', text: `${origin} runs ${version}` }
  })
  const detail = `${findings.map(({ text }) => text).join('; ')}.`
  const failed = findings.filter(({ status }) => status === 'fail')
  if (failed.length > 0) {
    return {
      ...base,
      status: 'fail',
      detail,
      fix: `Upgrade ${failed.map(({ origin }) => origin).join(', ')} to release line ${coreLine}.`,
    }
  }
  const hasPass = findings.some(({ status }) => status === 'pass')
  return { ...base, status: hasPass ? 'pass' : 'skip', detail }
}

function checkPreviewFrameSrc({ csp, siteOrigins }: HostFacts): HostCheckResult {
  const base = { id: 'preview-frame-src', title: 'frame-src for the preview', required: false }
  if (siteOrigins.length === 0) return { ...base, status: 'skip', detail: 'No site has a url.' }
  const sources = csp ? frameSources(csp) : []
  const missing = siteOrigins.filter((origin) => !allowsFrame(sources, origin))
  if (missing.length === 0) {
    return { ...base, status: 'pass', detail: `frame-src allows ${siteOrigins.join(', ')}.` }
  }
  return {
    ...base,
    status: 'fail',
    detail: `The admin's frame-src does not allow ${missing.join(', ')}.`,
    fix: `Add ${missing.join(', ')} to frame-src in the strapi::security config.`,
  }
}

/** The sources that govern frames: `frame-src`, else `child-src`, else `default-src` (CSP 3). */
function frameSources(csp: Record<string, string[]>): string[] {
  return csp['frame-src'] ?? csp['child-src'] ?? csp['default-src'] ?? []
}

function allowsFrame(sources: string[], origin: string): boolean {
  const scheme = origin.slice(0, origin.indexOf(':') + 1)
  return sources.some((source) => source === '*' || source === scheme || source === origin)
}

function parseVersion(version: string): number[] | undefined {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim())
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
}

function compareVersions(a: number[], b: number[]): number {
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
