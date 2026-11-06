/** An entry awaiting review, as `GET /micelio/review` answers it. */
export interface InReviewEntry {
  /** The content type, such as `api::page.page`. */
  uid: string
  /** The display name of the type, such as `Page`. */
  kind: string
  documentId: string
  /** `null` for a type that is not localised. */
  locale: string | null
  /** The entry's `title`, else its `name`, its `slug` or its `documentId`. */
  title: string
  /** When the draft was last written, the send to review included, as an ISO 8601 date. */
  updatedAt: string | null
  /** The note the editor sent it with, or `null`. */
  note: string | null
}

/** The entries of one site awaiting review. */
export interface InReviewSite {
  /** `null` for entries that have no site. */
  documentId: string | null
  name: string
  slug: string
  /** The oldest first. */
  entries: InReviewEntry[]
}
