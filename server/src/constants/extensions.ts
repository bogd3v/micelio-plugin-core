/** The locales Micelio's admin and archives are written in; `en` is the fallback. */
export const LOCALISED_LOCALES = ['en', 'es'] as const

/** The prefix of the attribute a site section adds to `plugin::micelio.site`, then its `id`. */
export const SITE_SECTION_ATTRIBUTE_PREFIX = 'section_'

/** The folder of the archive that holds the sections of plugins, then `<id>/`. */
export const PLUGIN_SECTIONS_FOLDER = 'plugins'

/** A registration `id`: lower case letters, digits and hyphens. */
export const EXTENSION_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Milliseconds a plugin's status check may take for one site. */
export const CHECK_TIMEOUT_MS = 10_000

/** The cron job that runs the status checks every day. */
export const STATUS_REFRESH_JOB = 'micelio-refresh-status'
