// The pure part of the Themes page (issue #59): what the frontend's answers hold, which pin an
// activation writes, and whether a pin is still installed. No Strapi import.

import type {
  CatalogueAccessibility,
  CatalogueCheckStatus,
  CatalogueChecks,
  CatalogueLayout,
  CatalogueMode,
  FrontendThemeCatalogue,
  FrontendThemeStatus,
  RequestedTheme,
  ThemeIdentity,
  ThemePin,
} from '../types/themes'

/**
 * What activating a theme does: the pin it writes, or why it cannot.
 *
 * - `pin`: the pin to write, `themeId` alone for a theme the image was built with, or the three
 *   fields for a data-only theme the frontend installs at runtime (ADR-0009 of `micelio`, section 3).
 * - `rebuild`: a code theme the image was not built with (ADR-0009, section 4), answered
 *   `themeRebuildRequired`.
 * - `unknown`: neither the image nor the catalogue holds that version of it.
 */
export type ActivationPlan =
  { kind: 'pin'; pin: ThemePin } | { kind: 'rebuild' } | { kind: 'unknown' }

/** The pin of no theme: the instance's default applies. */
export const EMPTY_PIN: ThemePin = { themeId: null, themeVersion: null, themeDigest: null }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'

const optionalString = (value: unknown): string | undefined => (isString(value) ? value : undefined)

// The fields of bogd3v/micelio#1018: an older frontend answers none, and one of another shape is left out.
const CHECK_STATUSES = new Set(['passed', 'failed', 'skipped', 'missing'])
const ACCESSIBILITY_STATUSES = new Set(['passed', 'passed-with-core-failures', 'partial', 'failed'])

/**
 * The plan of activating `theme` on a frontend whose status and catalogue are given.
 *
 * @remarks
 * A theme of `available.builtIn` at the version asked (or with none) is pinned by its id alone: a bare
 * id names a built-in theme, and a version with no digest is a partial pin the frontend ignores
 * (`server/lib/themeSwitch/switch.ts` of `micelio`). Any other theme must be in the catalogue at that
 * version: a data-only one is pinned with its package digest, a code one is `rebuild`. A version the
 * registry says does not run on this core is `unknown`: the frontend would refuse it.
 */
export function planActivation(
  theme: { id: string; version?: string },
  status: FrontendThemeStatus,
  catalogue: FrontendThemeCatalogue | null
): ActivationPlan {
  const builtIn = status.available.builtIn.find(({ id }) => id === theme.id)
  if (
    builtIn &&
    (theme.version === undefined ||
      builtIn.version === undefined ||
      builtIn.version === theme.version)
  ) {
    return { kind: 'pin', pin: { themeId: theme.id, themeVersion: null, themeDigest: null } }
  }
  if (theme.version === undefined) return { kind: 'unknown' }
  const installed = catalogue?.installed.find(
    ({ id, version }) => id === theme.id && version === theme.version
  )
  const listed = catalogue?.registry
    ?.find(({ id }) => id === theme.id)
    ?.versions.find(({ version }) => version === theme.version)
  if (installed?.code === true || listed?.code === true) return { kind: 'rebuild' }
  if (installed && installed.store === 'deployment') {
    return { kind: 'pin', pin: pinOf(theme.id, theme.version, installed.packageDigest) }
  }
  if (listed && listed.runs)
    return { kind: 'pin', pin: pinOf(theme.id, theme.version, listed.digest) }
  return { kind: 'unknown' }
}

/**
 * Whether the frontend still holds the theme a pin names, so reverting to it switches the site.
 *
 * @remarks
 * An empty pin is the instance's default, always there. An id alone is held when the image was built
 * with it; a full pin when the image was, at that version, or when it is the frontend's `lastGood` or
 * `active` package.
 */
export function isPinInstalled(pin: ThemePin, status: FrontendThemeStatus): boolean {
  if (!pin.themeId) return true
  const builtIn = status.available.builtIn.find(({ id }) => id === pin.themeId)
  if (!pin.themeVersion || !pin.themeDigest) return builtIn !== undefined
  if (builtIn && builtIn.version === pin.themeVersion) return true
  return [status.lastGood, status.active].some(
    (held) => held !== null && held.id === pin.themeId && held.packageDigest === pin.themeDigest
  )
}

/** Whether two pins name the same theme; empty fields are equal to missing ones. */
export function isSamePin(a: ThemePin, b: ThemePin): boolean {
  return (
    (a.themeId || null) === (b.themeId || null) &&
    (a.themeVersion || null) === (b.themeVersion || null) &&
    (a.themeDigest || null) === (b.themeDigest || null)
  )
}

/** The pin a stored value holds (a `theme` component or a log row's JSON); anything else is the empty pin. */
export function pinFrom(value: unknown): ThemePin {
  if (!isRecord(value)) return EMPTY_PIN
  const field = (name: string) => {
    const read = value[name]
    return isString(read) && read !== '' ? read : null
  }
  return {
    themeId: field('themeId'),
    themeVersion: field('themeVersion'),
    themeDigest: field('themeDigest'),
  }
}

/** The frontend's status, or `null` when the body is not one. */
export function parseThemeStatus(body: unknown): FrontendThemeStatus | null {
  if (!isRecord(body)) return null
  const active = identityOf(body.active)
  const available = isRecord(body.available) ? body.available : null
  if (!active || !available || !Array.isArray(available.builtIn)) return null
  return {
    active,
    requested: requestedOf(body.requested),
    lastGood: identityOf(body.lastGood),
    error: errorOf(body.error),
    available: {
      builtIn: available.builtIn.flatMap((item: unknown) =>
        isRecord(item) && isString(item.id)
          ? [{ id: item.id, version: optionalString(item.version), code: item.code === true }]
          : []
      ),
    },
  }
}

/**
 * The frontend's catalogue, or `null` when the body is not one. Entries of another shape are left out,
 * and so is an optional field of bogd3v/micelio#1018 (`name`, `modes`, `layout`, `checks`,
 * `accessibility`) that an older frontend lacks or that has another shape.
 */
export function parseThemeCatalogue(body: unknown): FrontendThemeCatalogue | null {
  if (!isRecord(body) || !Array.isArray(body.installed)) return null
  const list = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? value.filter(isRecord) : []
  return {
    installed: list(body.installed).flatMap((item) =>
      isString(item.id) && isString(item.version)
        ? [
            {
              id: item.id,
              version: item.version,
              packageDigest: isString(item.packageDigest) ? item.packageDigest : '',
              contract: isString(item.contract) ? item.contract : '',
              code: item.code === true,
              store: item.store === 'deployment' ? ('deployment' as const) : ('built-in' as const),
              report: optionalString(item.report),
              name: isString(item.name) && item.name !== '' ? item.name : undefined,
              modes: modesOf(item.modes),
              layout: layoutOf(item.layout),
            },
          ]
        : []
    ),
    registry: Array.isArray(body.registry)
      ? list(body.registry).flatMap((theme) =>
          isString(theme.id)
            ? [
                {
                  id: theme.id,
                  versions: list(theme.versions).flatMap((version) =>
                    isString(version.version) && isString(version.digest)
                      ? [
                          {
                            version: version.version,
                            digest: version.digest,
                            contract: isString(version.contract) ? version.contract : '',
                            license: isString(version.license) ? version.license : '',
                            tier: isString(version.tier) ? version.tier : '',
                            status: isString(version.status) ? version.status : '',
                            code: version.code === true,
                            report: optionalString(version.report),
                            runs: version.runs === true,
                          },
                        ]
                      : []
                  ),
                },
              ]
            : []
        )
      : null,
    reason: isString(body.reason) ? body.reason : null,
    updates: list(body.updates).flatMap((update) =>
      isString(update.id) && isString(update.from) && isString(update.version)
        ? [
            {
              id: update.id,
              from: update.from,
              store:
                update.store === 'deployment' ? ('deployment' as const) : ('built-in' as const),
              version: update.version,
              digest: isString(update.digest) ? update.digest : '',
            },
          ]
        : []
    ),
    reports: list(body.reports).flatMap((report) =>
      isString(report.id) && isString(report.version) && isString(report.digest)
        ? [
            {
              id: report.id,
              version: report.version,
              digest: report.digest,
              ok: report.ok === true,
              summary: isString(report.summary) ? report.summary : '',
              checks: checksOf(report.checks),
              accessibility: accessibilityOf(report.accessibility),
            },
          ]
        : []
    ),
  }
}

function modesOf(value: unknown): CatalogueMode[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((mode: unknown) =>
    isRecord(mode) && isString(mode.id) && (mode.scheme === 'light' || mode.scheme === 'dark')
      ? [{ id: mode.id, scheme: mode.scheme, name: optionalString(mode.name) }]
      : []
  )
}

function layoutOf(value: unknown): CatalogueLayout | undefined {
  if (!isRecord(value)) return undefined
  const { header, home, postList, article, footer } = value
  return isString(header) &&
    isString(home) &&
    isString(postList) &&
    isString(article) &&
    isString(footer)
    ? { header, home, postList, article, footer }
    : undefined
}

function checksOf(value: unknown): CatalogueChecks | undefined {
  if (!isRecord(value)) return undefined
  const { static: staticCheck, quality, performance } = value
  return isCheckStatus(staticCheck) && isCheckStatus(quality) && isCheckStatus(performance)
    ? { static: staticCheck, quality, performance }
    : undefined
}

function isCheckStatus(value: unknown): value is CatalogueCheckStatus {
  return isString(value) && CHECK_STATUSES.has(value)
}

function accessibilityOf(value: unknown): CatalogueAccessibility | null | undefined {
  if (value === null) return null
  if (
    !isRecord(value) ||
    !isString(value.status) ||
    !ACCESSIBILITY_STATUSES.has(value.status) ||
    typeof value.current !== 'boolean' ||
    !(value.date === null || isString(value.date))
  ) {
    return undefined
  }
  return {
    status: value.status as CatalogueAccessibility['status'],
    current: value.current,
    date: value.date,
  }
}

function pinOf(themeId: string, themeVersion: string, themeDigest: string): ThemePin {
  return { themeId, themeVersion, themeDigest }
}

function identityOf(value: unknown): ThemeIdentity | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.digest)) return null
  return {
    id: value.id,
    version: optionalString(value.version),
    digest: value.digest,
    packageDigest: isString(value.packageDigest) ? value.packageDigest : '',
  }
}

function requestedOf(value: unknown): RequestedTheme | null {
  if (!isRecord(value) || !isString(value.id)) return null
  return {
    id: value.id,
    version: optionalString(value.version),
    digest: optionalString(value.digest),
  }
}

function errorOf(value: unknown): FrontendThemeStatus['error'] {
  if (!isRecord(value) || !isString(value.rule) || !isString(value.message)) return null
  return {
    rule: value.rule,
    message: value.message,
    at: isString(value.at) ? value.at : '',
    requested: requestedOf(value.requested),
  }
}
