import type {
  CatalogueLayout,
  CatalogueMode,
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

/** Which list of the Themes page a card belongs to, and so its badge and buttons. */
export type ThemeCardKind = 'installed' | 'registry' | 'update'

/** A theme as one card of the Themes page shows it (issue #288). */
export interface ThemeCardModel {
  kind: ThemeCardKind
  theme: ThemeRef
  /** The catalogue's `name` of the theme, or its id when the catalogue has none. */
  name: string
  code: boolean
  /** The contract the version declares, as `major.minor`; empty when the catalogue does not say. */
  contract: string
  /** The SPDX id of a registry version. */
  license?: string
  /** The tier of a registry version. */
  tier?: string
  /** The installed version an update replaces. */
  from?: string
  modes?: CatalogueMode[]
  layout?: CatalogueLayout
  report?: CatalogueReport
  /** Whether this core runs the version; `false` only for a registry version that says so. */
  runs: boolean
}

/** What a semver change from one version to another is. */
export type VersionChange = 'major' | 'minor' | 'patch'

/**
 * The cards of the three tabs of the Themes page, from the frontend's catalogue: the installed themes
 * (the active one first), the newest published version of each registry theme, and the updates.
 *
 * @remarks
 * A registry or update card takes the `name`, `modes` and `layout` of an installed theme of the same id
 * (bogd3v/micelio#1018 lists them for installed themes only); a frontend without them gives the id.
 */
export function themeCards(
  catalogue: FrontendThemeCatalogue | null,
  status: FrontendThemeStatus | null
): Record<ThemeCardKind, ThemeCardModel[]> {
  const installedOf = (id: string) => catalogue?.installed.find((theme) => theme.id === id)
  // The modes and variants are those of the installed version: another version may change them.
  const looks = (id: string, version: string) => {
    const theme = installedOf(id)
    const same = theme?.version === version ? theme : undefined
    return {
      name: theme?.name ?? id,
      ...(same?.modes ? { modes: same.modes } : {}),
      ...(same?.layout ? { layout: same.layout } : {}),
    }
  }
  const installed = [...(catalogue?.installed ?? [])]
    .sort((a, b) => Number(isActive(b, status)) - Number(isActive(a, status)))
    .map((theme): ThemeCardModel => ({
      kind: 'installed',
      theme: { id: theme.id, version: theme.version },
      ...looks(theme.id, theme.version),
      code: theme.code,
      contract: theme.contract,
      report: reportOf(theme.report, catalogue),
      runs: true,
    }))
  const registry = (catalogue?.registry ?? []).flatMap(({ id, versions }): ThemeCardModel[] => {
    const newest = versions.find(({ status: state }) => state === 'published') ?? versions[0]
    if (!newest) return []
    return [
      {
        kind: 'registry',
        theme: { id, version: newest.version },
        ...looks(id, newest.version),
        code: newest.code,
        contract: newest.contract,
        license: newest.license,
        tier: newest.tier,
        report: reportOf(newest.report, catalogue),
        runs: newest.runs,
      },
    ]
  })
  const updates = (catalogue?.updates ?? []).map((update): ThemeCardModel => {
    const listed = catalogue?.registry
      ?.find(({ id }) => id === update.id)
      ?.versions.find(({ version }) => version === update.version)
    return {
      kind: 'update',
      theme: { id: update.id, version: update.version },
      name: installedOf(update.id)?.name ?? update.id,
      code: listed?.code ?? false,
      contract: listed?.contract ?? '',
      from: update.from,
      report: catalogue?.reports.find(
        ({ id, version }) => id === update.id && version === update.version
      ),
      runs: true,
    }
  })
  return { installed, registry, update: updates }
}

/** The modes of a theme by name, or by id when one has no name, in the theme's order. */
export function modeNames(modes: CatalogueMode[]): string[] {
  return modes.map(({ id, name }) => name || id)
}

/** The variants a theme picked for header, home, post list, article and footer, in that order. */
export function layoutVariants(layout: CatalogueLayout): string[] {
  return [layout.header, layout.home, layout.postList, layout.article, layout.footer]
}

/**
 * What an admission report's chip adds to "Admitted": `aa` when its static and quality checks passed,
 * `budgets` when its performance runs passed. A report without `checks` (an older frontend) adds none.
 */
export function admissionPasses(report: CatalogueReport): { aa: boolean; budgets: boolean } {
  return {
    aa: report.checks?.static === 'passed' && report.checks.quality === 'passed',
    budgets: report.checks?.performance === 'passed',
  }
}

/**
 * The date of the manual accessibility check a report records as passed for the version it admitted:
 * `''` when the record has no date, `null` when there is no such check.
 */
export function manualCheckDate(report: CatalogueReport | undefined): string | null {
  const record = report?.accessibility
  if (!record || record.status !== 'passed' || !record.current) return null
  return record.date ?? ''
}

/**
 * The part of `major.minor.patch` that differs first between `from` and `to`, the parts compared as
 * written; `patch` when neither the major nor the minor differs.
 */
export function versionChange(from: string, to: string): VersionChange {
  const [fromMajor, fromMinor] = from.split(/[.+-]/)
  const [toMajor, toMinor] = to.split(/[.+-]/)
  if (fromMajor !== toMajor) return 'major'
  return fromMinor !== toMinor ? 'minor' : 'patch'
}

/**
 * Whether a theme is a code theme the frontend's image was not built with: it never activates on that
 * image (ADR-0009 of `micelio`, section 4): the Themes page's card says it needs an image built with it,
 * and the theme preview shows the rebuild notice instead of Activate.
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
