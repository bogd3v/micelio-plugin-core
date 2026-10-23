/** Why an export or an import was refused, as the `code` of its problem detail. */
export type ExportErrorCode =
  | 'exportSiteNotFound'
  | 'exportMediaUnreadable'
  | 'exportArchiveCorrupt'
  | 'exportFormatUnsupported'
  | 'exportDocumentInvalid'
  | 'exportEditorialInconsistent'
  | 'exportLocaleMissing'
  | 'exportSiteSlugTaken'
  | 'exportHostTaken'
  | 'exportMediaRefused'

/** A refused export or import, with its code (`docs/export-format.md`). */
export class ExportError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ExportError'
  }
}
