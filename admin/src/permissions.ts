/** Opens the status page; the server's `STATUS_READ_PERMISSION`, registered in its `bootstrap`. */
export const STATUS_READ_PERMISSION = { action: 'plugin::micelio.status.read', subject: null }

/** Opens the preview page; the server's `PREVIEW_PERMISSION`, registered in its `bootstrap`. */
export const PREVIEW_PERMISSION = { action: 'plugin::micelio.preview', subject: null }

/** Opens the Export and import page; the server's `TRANSFER_PERMISSION`, registered in its `bootstrap`. */
export const TRANSFER_PERMISSION = { action: 'plugin::micelio.transfer', subject: null }

/** Lets an export hold personal data; the server's `TRANSFER_PERSONAL_PERMISSION`. */
export const TRANSFER_PERSONAL_PERMISSION = {
  action: 'plugin::micelio.transfer.personal',
  subject: null,
}

/** Opens the Block catalogue page; the server's `BLOCKS_READ_PERMISSION`, registered in its `bootstrap`. */
export const BLOCKS_READ_PERMISSION = { action: 'plugin::micelio.blocks.read', subject: null }

/** Lets a role change a site's settings of a block; the server's `BLOCKS_MANAGE_PERMISSION`. */
export const BLOCKS_MANAGE_PERMISSION = { action: 'plugin::micelio.blocks.manage', subject: null }
