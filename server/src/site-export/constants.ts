/** The `format` of every archive (`docs/export-format.md`). */
export const EXPORT_FORMAT = 'micelio-site-export'

/** The format version this release writes and reads, `major.minor`. */
export const EXPORT_FORMAT_VERSION = '1.1'

/** Where the manifest lives in the archive. */
export const MANIFEST_PATH = 'manifest.json'

/** Where the media index lives in the archive. */
export const MEDIA_INDEX_PATH = 'media/index.json'

/** The folder of the media files, each named by its SHA-256. */
export const MEDIA_FOLDER = 'media/sha256'

/** The folder of the content files, one per export name. */
export const CONTENT_FOLDER = 'content'
