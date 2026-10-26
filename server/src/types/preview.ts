/** What every preview credential is bound to: one document of one site. */
export interface PreviewTarget {
  /** The `documentId` of the site. */
  siteDocumentId: string
  /** The content type UID. */
  contentType: string
  entryDocumentId: string
  /** The locale of the draft; `null` for a type that is not localised. */
  entryLocale: string | null
}

/** What a preview token or grant is bound to (ADR-0019, section 3). */
export interface PreviewBinding extends PreviewTarget {
  /** The `id` of the admin user who asked for the token. */
  adminUser: number
  /** The origin of the admin page that asked, which the frontend frames itself for. */
  adminOrigin: string
}

/**
 * What a system grant is bound to (ADR-0019, amendment of 2026-10-25): a document and the version
 * of its draft, and no admin user.
 */
export interface PreviewSystemBinding extends PreviewTarget {
  /** The `updatedAt` of the draft at the moment of minting, as an ISO 8601 date. */
  entryVersion: string
}

/** Which of the credentials a record is: a token, a grant, or the plugin's own system grant. */
export type PreviewCredentialKind = 'token' | 'grant' | 'system'

/** Who a grant acts for: an admin user, or the plugin itself. */
export type PreviewActor = 'admin' | 'system'

/** A credential as the store keeps it: never its value, only the hash. */
export interface PreviewCredentialRecord extends PreviewTarget {
  kind: PreviewCredentialKind
  /** SHA-256 of the value, in hex. */
  hash: string
  /** The admin user a token or grant is bound to; `null` for a system grant. */
  adminUser: number | null
  /** The admin origin a token or grant is bound to; `null` for a system grant. */
  adminOrigin: string | null
  /** The `updatedAt` of the draft a system grant was minted for; `null` for the other kinds. */
  entryVersion: string | null
  expiresAt: Date
  /** When a token was exchanged or a system grant was used; `null` while unused, and always `null` for a grant. */
  usedAt: Date | null
  /** When logging out or losing the right to read the document ended it. */
  revokedAt: Date | null
}

/** The grant a request presented, once it checked out: what it names and who it acts for. */
export interface PreviewResolvedGrant extends PreviewTarget {
  actor: PreviewActor
  /** The version a `system` grant was minted for; `null` for an `admin` grant. */
  entryVersion: string | null
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
