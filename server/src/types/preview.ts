/** What a preview token or grant is bound to (ADR-0019, section 3). */
export interface PreviewBinding {
  /** The `id` of the admin user who asked for the token. */
  adminUser: number
  /** The origin of the admin page that asked, which the frontend frames itself for. */
  adminOrigin: string
  /** The `documentId` of the site. */
  siteDocumentId: string
  /** The content type UID. */
  contentType: string
  entryDocumentId: string
  /** The locale of the draft; `null` for a type that is not localised. */
  entryLocale: string | null
}

/** Which of the two credentials a record is. */
export type PreviewCredentialKind = 'token' | 'grant'

/** A credential as the store keeps it: never its value, only the hash. */
export interface PreviewCredentialRecord extends PreviewBinding {
  kind: PreviewCredentialKind
  /** SHA-256 of the value, in hex. */
  hash: string
  expiresAt: Date
  /** When a token was exchanged; `null` while unused, and always `null` for a grant. */
  usedAt: Date | null
  /** When logging out or losing the right to read the document ended it. */
  revokedAt: Date | null
}

/** What a request presents a credential for. Absent fields are not checked. */
export interface PreviewExpectation {
  siteDocumentId: string
  entryDocumentId?: string
  /** `null` expects a draft that is not localised. */
  entryLocale?: string | null
}

/** What `POST /micelio/preview/token` answers. */
export interface PreviewTokenAnswer {
  /** `<site.url>/_preview?token=<token>`; it carries the token, so it is never logged. */
  url: string
  /** When the token expires, as an ISO 8601 date. */
  expiresAt: string
}

/** What the exchange answers: the grant and what it is bound to. */
export interface PreviewGrantAnswer {
  /** The grant's value; the frontend keeps it in an `HttpOnly` cookie and never logs it. */
  grant: string
  /** When the grant expires, as an ISO 8601 date. */
  expiresAt: string
  /** The admin origin bound in the grant; the frontend refuses the grant when it differs from its configured admin origin. */
  adminOrigin: string
  /** The content type UID of the draft. */
  contentType: string
  documentId: string
  /** The locale of the draft; `null` for a type that is not localised. */
  locale: string | null
}
