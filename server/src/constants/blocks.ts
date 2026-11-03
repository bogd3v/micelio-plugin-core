/** The UID of the per-site settings of the block catalogue: one row per site and block. */
export const BLOCK_SETTING_UID = 'plugin::micelio.block-setting'

/** The admin permission that opens the Block catalogue page and reads its routes; the admin keeps its own copy. */
export const BLOCKS_READ_PERMISSION = 'plugin::micelio.blocks.read'

/** The admin permission that changes a site's settings of a block; it needs `BLOCKS_READ_PERMISSION` to reach the page. */
export const BLOCKS_MANAGE_PERMISSION = 'plugin::micelio.blocks.manage'

/** The `code` of the problem detail a save refused for a block the site disabled or does not allow on the page's type. */
export const BLOCK_NOT_ALLOWED = 'blockNotAllowed'

/** The `code` of the problem detail a refused setting (an unknown block or page type, a malformed label) answers. */
export const BLOCK_SETTING_INVALID = 'blockSettingInvalid'

/** The locales a block's label in the palette is kept in. */
export const LABEL_LOCALES = ['en', 'es'] as const

/** The longest label of a block in the palette, in characters. */
export const LABEL_MAX_LENGTH = 60
