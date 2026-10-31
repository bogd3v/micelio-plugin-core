/** The UID of the internal store of exports and imports: one row per export job and per staged or applied import. */
export const TRANSFER_UID = 'plugin::micelio.transfer'

/** The admin permission that opens the Export and import page and its routes; the admin keeps its own copy. */
export const TRANSFER_PERMISSION = 'plugin::micelio.transfer'

/** The admin permission that lets an export hold personal data; it needs `TRANSFER_PERMISSION` too. */
export const TRANSFER_PERSONAL_PERMISSION = 'plugin::micelio.transfer.personal'

/** How long an export can be downloaded: 24 hours, in milliseconds. */
export const TRANSFER_EXPIRY_MS = 24 * 60 * 60 * 1000

/** The folder of the archives under `transfersDirectory`'s default, `<app root>/.tmp`. */
export const TRANSFERS_FOLDER = 'micelio-transfers'

/** The ending of the name of an archive. */
export const ARCHIVE_EXTENSION = '.micelio.tar.gz'

/** The admin permission of the Content Manager that publishes a type: the subject is its UID. */
export const PUBLISH_PERMISSION = 'plugin::content-manager.explorer.publish'

/** Uploaded archives one admin user may keep staged at once. */
export const MAX_STAGED_PER_USER = 3

/** The most an uploaded archive may hold uncompressed unless `transferMaxBytes` says otherwise: 1 GiB. */
export const DEFAULT_TRANSFER_MAX_BYTES = 1024 * 1024 * 1024
