import type {
  CatalogueReport,
  FrontendThemeCatalogue,
  FrontendThemeStatus,
  ThemePin,
} from '../../../server/src/types/themes'

/** A theme the pages name: an id and, but for a built-in theme pinned by id alone, a version. */
export interface ThemeRef {
  id: string
  version?: string
}

/**
 * Whether a theme is a code theme the frontend's image was not built with: it never activates on that
 * image (ADR-0009 of `micelio`, section 4), and the page shows the rebuild notice instead of the button.
 * The server decides it again on activation (`server/src/themes/rules.ts`).
 */
export function needsRebuild(
  theme: ThemeRef & { code: boolean },
  status: FrontendThemeStatus | null
): boolean {
  if (!theme.code) return false
  return !status?.available.builtIn.some(
    ({ id, version }) =>
      id === theme.id && (!version || !theme.version || version === theme.version)
  )
}

/** Whether the frontend renders that theme now. */
export function isActive(theme: ThemeRef, status: FrontendThemeStatus | null): boolean {
  if (!status || status.active.id !== theme.id) return false
  return !theme.version || !status.active.version || status.active.version === theme.version
}

/** The admission report a theme's `report` digest names, when the catalogue read it. */
export function reportOf(
  digest: string | undefined,
  catalogue: FrontendThemeCatalogue | null
): CatalogueReport | undefined {
  return digest ? catalogue?.reports.find((report) => report.digest === digest) : undefined
}

/** Whether a store of the frontend holds that version of a theme, which a preview needs: a preview installs nothing. */
export function isInstalled(theme: ThemeRef, catalogue: FrontendThemeCatalogue | null): boolean {
  return (
    catalogue?.installed.some(
      ({ id, version }) => id === theme.id && (!theme.version || version === theme.version)
    ) ?? false
  )
}

/** `id version`, or the id alone. */
export function themeLabel(theme: ThemeRef): string {
  return theme.version ? `${theme.id} ${theme.version}` : theme.id
}

/** The theme a pin names; `null` for an empty pin, the instance's default. */
export function themeOfPin(pin: ThemePin): ThemeRef | null {
  return pin.themeId
    ? { id: pin.themeId, ...(pin.themeVersion ? { version: pin.themeVersion } : {}) }
    : null
}

/**
 * Where a switch the page asked for stands, from the frontend's status: `done` once the frontend
 * renders the theme the pin names (or, for an empty pin, asks for none), `failed` with the reason
 * once the frontend refused it, `waiting` until then.
 *
 * @param before - The frontend's error when the pin was written. It is not this change's failure:
 * only an error that differs from it (another time or reason) and names the theme asked for is.
 */
export function switchOutcome(
  wanted: ThemeRef | null,
  status: FrontendThemeStatus | null,
  before: FrontendThemeStatus['error'] = null
): { kind: 'waiting' } | { kind: 'done' } | { kind: 'failed'; message: string } {
  if (!status) return { kind: 'waiting' }
  const { error } = status
  const isNew =
    error !== null &&
    (before === null || error.at !== before.at || error.message !== before.message)
  if (isNew && (wanted === null ? !error.requested : error.requested?.id === wanted.id)) {
    return { kind: 'failed', message: error.message }
  }
  if (wanted === null) return status.requested === null ? { kind: 'done' } : { kind: 'waiting' }
  return isActive(wanted, status) ? { kind: 'done' } : { kind: 'waiting' }
}
