/** UID of the `category` content type: the topics an entry is filed under. */
export const CATEGORY_UID = 'plugin::micelio.category'

/** UID of the `tag` content type: the labels an entry carries. */
export const TAG_UID = 'plugin::micelio.tag'

/**
 * Content API actions a read-only token needs for the taxonomy types.
 *
 * @remarks
 * A distribution spreads them into its token lists, so this plugin stays the source of truth for
 * its own UIDs. Role and token grants stay in the host: a plugin's `bootstrap` has no order
 * relative to the other plugins' (ADR-0017, amendment of 2026-10-23).
 */
export const READ_ACTIONS = [`${CATEGORY_UID}.find`, `${TAG_UID}.find`] as const
