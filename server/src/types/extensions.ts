// The extension points a sibling plugin uses to appear in the Micelio admin and in the site archive:
// a contract of section 6 of the standard (the plugin hooks API). The reference in `docs/hooks.md`
// is generated from the TSDoc of this file (`npm run reference`), and `npm run lint:reference`
// fails when it drifts.

/**
 * A text in every locale the admin supports.
 *
 * @remarks
 * The core shows the locale of the admin user and falls back to `en`. A locale left out is
 * accepted at runtime; `missingLocales` finds it, for the registering plugin's own tests.
 */
export interface LocalisedText {
  en: string
  es: string
}

/** The site an extension point runs for: plain data, never a Strapi entity. */
export interface ExtensionSite {
  /** The site's `documentId`, as the `site` of a hook payload. */
  documentId: string
  slug: string
}

/** Where a sub-navigation item sits. */
export type AdminPageGroup = 'site' | 'content' | 'overview'

/** A page of a sibling plugin in the Micelio sub-navigation. */
export interface AdminPageRegistration {
  /** Unique among pages: lower case letters, digits and hyphens, such as `fediverse`. */
  id: string
  group: AdminPageGroup
  label: LocalisedText
  /**
   * The page's path under `/plugins/micelio/`, such as `fediverse`: lower case letters, digits,
   * hyphens and `/`. `about` is the core's own page and is refused.
   */
  to: string
  /**
   * The admin permission that shows the item, such as `plugin::fediverse.read`. The core never
   * widens it: the item is hidden from a role without it.
   */
  permission: string
}

/** A per-site settings section of a sibling plugin. */
export interface SiteSectionRegistration {
  /** Unique among sections: lower case letters, digits and hyphens. */
  id: string
  /**
   * The UID of the plugin's component, `<category>.<name>`, already in Strapi's registry when
   * this is called. The core adds it to `plugin::micelio.site` as a non-repeatable component, so
   * every site has one instance.
   */
  component: string
  label: LocalisedText
  /**
   * The name of the panel the plugin's admin offers for the site view. The core keeps and
   * answers it with the section; the Sites view that renders it under the core fields is a
   * separate piece of the admin.
   */
  panel: string
  /**
   * The admin permission that reads the section: the section travels with the site in
   * `GET /micelio/sites` only for a caller who has it.
   */
  permission: string
}

/** The result of one status check. */
export interface Check {
  /** Unique within the plugin's checks for one site. */
  id: string
  title: LocalisedText
  status: 'ok' | 'warn' | 'fail'
  /** What was found. */
  detail?: LocalisedText
  /** What to do about a `warn` or a `fail`. */
  fix?: LocalisedText
}

/** A group of status checks of a sibling plugin, shown as one card in the Status page. */
export interface StatusChecksRegistration {
  /** Unique among status checks: lower case letters, digits and hyphens. */
  id: string
  label: LocalisedText
  /**
   * The admin permission that shows the card and its results in the status response.
   */
  permission: string
  /**
   * Runs the plugin's checks for one site.
   *
   * @remarks
   * Called for every site, on "Run again" and on the daily refresh, never when the page loads. A
   * call that throws or takes more than 10 seconds is reported as a failed check of the plugin
   * and logged. It runs outside any request: it must not assume an admin user.
   */
  run(site: ExtensionSite): Promise<Check[]> | Check[]
}

/** A file of a plugin's section of the archive. */
export interface ExportEntry {
  /**
   * The path under `plugins/<id>/`: lower case ASCII letters, digits, `.`, `_` and `-`, in
   * segments separated by `/`.
   */
  path: string
  /** The file's bytes; a string is written as UTF-8. */
  body: Uint8Array | string
}

/** What a section's `read` did, for the import report. */
export interface SectionImportReport {
  /** Entries it wrote. */
  imported: number
  /** Entries it left out. */
  skipped: number
}

/** A plugin's section of the site archive (`docs/export-format.md`, "Plugin sections"). */
export interface ExportSectionRegistration {
  /** Unique among sections: lower case letters, digits and hyphens. The archive folder is `plugins/<id>/`. */
  id: string
  /**
   * The section's format, `major.minor`, written in the manifest. An import skips a section whose
   * major differs from the registered one.
   */
  version: string
  /**
   * Whether the section holds personal data that the site does not show. Such a section is left
   * out of an export unless it is asked for by `id` (`micelio export --include <id>`), and every
   * export that includes it is logged.
   */
  personalData: boolean
  /**
   * The admin permission that manages the section. A caller that has an admin user (the export
   * dialog) must check it before it asks for the section; the CLI has no user.
   */
  permission: string
  /**
   * Writes the section's files for one site, in any order; the archive sorts them.
   *
   * @remarks
   * Called while the archive is built, only when the section is included. The core adds the
   * files to the manifest with their sizes and SHA-256.
   */
  write(site: ExtensionSite): AsyncIterable<ExportEntry>
  /**
   * Reads the section's files into the target site.
   *
   * @remarks
   * Called by an import of an archive that holds the section, inside the import's database
   * transaction and after the core's content is written: a throw refuses the whole import
   * (`exportSectionFailed`) and rolls everything back. `entries` are verified against the
   * manifest.
   */
  read(site: ExtensionSite, entries: ExportEntry[]): Promise<SectionImportReport>
}

/**
 * The extension points: `strapi.plugin('micelio').service('extensions')`.
 *
 * @remarks
 * Adding an extension point is a MINOR of the core; removing or renaming one, or changing what a
 * registration means, is a MAJOR (section 6 of the standard).
 *
 * - Register in your plugin's `register`, with `strapi.plugin('micelio').service('extensions')`: the
 *   service exists from the start, whatever the order Strapi registers plugins in. Status checks,
 *   admin pages and export sections may also be registered in `bootstrap`; a site section may
 *   not, because the database models are built after `register`.
 * - Every registration is keyed by `id` and refused when the `id` is taken, with a `TypeError`
 *   that says so. A registration is validated when it is made, so the plugin fails at boot, not
 *   in front of an editor.
 * - Everything is visible only with the registering plugin's `permission`, and nothing runs when
 *   an admin page loads.
 */
export interface MicelioExtensions {
  /**
   * Adds a page of your plugin to the Micelio sub-navigation.
   *
   * @remarks
   * The core lists the item in its group for admin users who have `permission`. The page itself
   * is provided by your plugin's admin with `apis.registerPage` of the Micelio admin plugin; do
   * not add a menu link of your own.
   *
   * @throws `TypeError` when the registration is malformed, its `id` or `to` is taken, or `to` is a path
   * the core reserves.
   *
   * @example
   * ```ts
   * strapi.plugin('micelio').service('extensions').registerAdminPage({
   *   id: 'fediverse',
   *   group: 'site',
   *   label: { en: 'Fediverse', es: 'Fediverso' },
   *   to: 'fediverse',
   *   permission: 'plugin::fediverse.read',
   * })
   * ```
   */
  registerAdminPage(page: AdminPageRegistration): void
  /**
   * Attaches your plugin's component to every site.
   *
   * @remarks
   * The core adds `component` to `plugin::micelio.site` as a non-repeatable component, creates its
   * instance when a site is created (and for the sites that exist when the section is first
   * registered), and answers it with the site in `GET /micelio/sites` for callers who have
   * `permission`.
   *
   * @throws `TypeError` when the registration is malformed, its `id` is taken, the component is
   * not in Strapi's registry or the database models are already built.
   */
  registerSiteSection(section: SiteSectionRegistration): void
  /**
   * Adds checks of your plugin to the Status page.
   *
   * @remarks
   * The core runs them for every site on "Run again" and on the daily refresh
   * (`statusRefreshRule`), keeps the latest results, and answers them under
   * `plugins[<id>].checks` of `GET /micelio/status` for callers who have `permission`. They are
   * part of "Copy diagnostics" as one line per plugin.
   *
   * @throws `TypeError` when the registration is malformed or its `id` is taken.
   */
  registerStatusChecks(checks: StatusChecksRegistration): void
  /**
   * Adds a section of your plugin to the site archive.
   *
   * @remarks
   * An export writes its files under `plugins/<id>/` with `version` in the manifest; an import
   * hands them to `read`. An import of a section nobody registered, or of another major, reports
   * it as skipped.
   *
   * @throws `TypeError` when the registration is malformed or its `id` is taken.
   */
  registerExportSection(section: ExportSectionRegistration): void
}
