// What the Themes page reads and writes (issue #59). The frontend's shapes are copies of
// `ThemeStatus` and `ThemeCatalogue` of `app/interfaces/theme.ts` of `micelio`: this plugin reads them
// over HTTP and never imports the frontend.

/** What the site settings ask for, as the frontend's status names it: an id alone, or an exact version and its digest. */
export interface RequestedTheme {
  id: string
  version?: string
  digest?: string
}

/** A theme the frontend holds, as its status names it. */
export interface ThemeIdentity {
  id: string
  version?: string
  /** The `<digest>` of the frontend's `/_t/<digest>/`. */
  digest: string
  /** `sha256:` of the package; the value `themeDigest` pins. */
  packageDigest: string
}

/** What `GET <site.url>/api/theme/status` answers (ADR-0009 of `micelio`, section 6). */
export interface FrontendThemeStatus {
  active: ThemeIdentity
  /** What the site settings name now; `null` when they name none and the instance's default applies. */
  requested: RequestedTheme | null
  /** The theme that was active before the last switch. */
  lastGood: ThemeIdentity | null
  /** Why the last switch failed, until a later one succeeds. */
  error: { rule: string; message: string; at: string; requested: RequestedTheme | null } | null
  available: {
    /** The themes compiled into the image: a code theme activates only from here. */
    builtIn: { id: string; version?: string; code: boolean }[]
  }
}

/** A theme of one of the frontend's stores. */
export interface CatalogueInstalledTheme {
  id: string
  version: string
  packageDigest: string
  /** The contract the theme declares, as `major.minor`. */
  contract: string
  /** Whether the theme ships slots, which only an image built with it runs (ADR-0009 of `micelio`, section 4). */
  code: boolean
  store: 'built-in' | 'deployment'
  /** The digest of its admission report, when the registry's index names one. */
  report?: string
}

/** One version of a theme of the registry's index. */
export interface CatalogueVersion {
  version: string
  /** `sha256:` of the package: the `themeDigest` a data-only theme is pinned with. */
  digest: string
  contract: string
  license: string
  tier: string
  status: string
  code: boolean
  report?: string
  /** Whether this core runs the version. */
  runs: boolean
}

/** A theme of the registry's index, its versions newest first. */
export interface CatalogueTheme {
  id: string
  versions: CatalogueVersion[]
}

/** A newer version of an installed theme. */
export interface CatalogueUpdate {
  id: string
  /** The installed version. */
  from: string
  store: CatalogueInstalledTheme['store']
  version: string
  digest: string
}

/** The result of an admission report. */
export interface CatalogueReport {
  id: string
  version: string
  /** The report's digest, which `report` of a theme names. */
  digest: string
  /** Whether admission found no error. */
  ok: boolean
  /** The Markdown summary of the report. */
  summary: string
}

/** What `GET <site.url>/api/theme/catalogue` answers (bogd3v/micelio#993). */
export interface FrontendThemeCatalogue {
  installed: CatalogueInstalledTheme[]
  /** The themes of the registry's index; `null` when it has not been read or did not verify. */
  registry: CatalogueTheme[] | null
  /** Why there is no registry, one line; `null` after a read that succeeded. */
  reason: string | null
  updates: CatalogueUpdate[]
  reports: CatalogueReport[]
}

/** The pin of a site's `theme` component; `null` fields are empty. */
export interface ThemePin {
  themeId: string | null
  themeVersion: string | null
  themeDigest: string | null
}

/** A page of a site the theme preview can show: the newest draft of one page type. */
export interface ThemePreviewPage {
  uid: string
  documentId: string
  locale: string | null
  /** Its `title`, or its `documentId` when the type has no title. */
  title: string
  /** Its `pageType` (`withPageSettings`); `standard` when it has none. */
  pageType: string
}

/** What `GET /micelio/themes?site=` answers. */
export interface ThemesAnswer {
  /** The sites the page can switch to, the default one first. */
  sites: { slug: string; name: string; isDefault: boolean }[]
  /** The site the answer is for. */
  site: { slug: string; name: string; isDefault: boolean; origin: string | null }
  /** The site's own pin, as its `theme` component holds it; `null` fields when it has none. */
  pin: ThemePin
  /** The frontend's status; `null` when it did not answer within two seconds, or answered something else. */
  status: FrontendThemeStatus | null
  /** The frontend's catalogue; `null` when it did not answer within two seconds, or answered something else. */
  catalogue: FrontendThemeCatalogue | null
  /**
   * The pin the last activation of the site replaced, which `POST /micelio/themes/revert` writes back;
   * `null` when there is none to revert to. `isInstalled` says whether the frontend still holds it.
   */
  revert: { pin: ThemePin; isInstalled: boolean } | null
  /** The newest draft of each page type of the site, newest first: the pages the theme preview shows. */
  pages: ThemePreviewPage[]
}

/** What `POST /micelio/themes/activate` and `POST /micelio/themes/revert` answer. */
export interface ThemeActivationAnswer {
  site: string
  before: ThemePin
  after: ThemePin
}
