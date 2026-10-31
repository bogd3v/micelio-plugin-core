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
  | 'exportSectionUnknown'
  | 'exportSectionFailed'

/** A refused export or import, with its code (`docs/export-format.md`). */
export class ExportError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    message: string,
    /**
     * `otherSite` when an `exportDocumentInvalid` is a document that another site of the target
     * holds under the same `documentId`: only the policy `keep-both` can import it.
     */
    readonly reason?: 'otherSite'
  ) {
    super(message)
    this.name = 'ExportError'
  }
}
