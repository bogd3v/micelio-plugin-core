/** UID of the `site` content type: one row per site the CMS serves (ADR-0017, section 4). */
export const SITE_UID = 'plugin::micelio.site'

/**
 * Category of the components the `site` type uses.
 *
 * @remarks
 * Not `site`: `micelio-cms` 0.6 registers `site.*` for its own `site-setting`, and a component UID
 * can be registered once. The cut-over of release line 0.7 copies those rows into these.
 */
export const SITE_COMPONENT_CATEGORY = 'micelio-site'

/** Slug of the site a fresh instance starts with. */
export const DEFAULT_SITE_SLUG = 'default'
