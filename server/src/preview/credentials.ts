import { createHash, randomBytes } from 'node:crypto'
import { PREVIEW_GRANT_TTL_SECONDS, PREVIEW_TOKEN_TTL_SECONDS } from '../constants/preview'
import type {
  PreviewBinding,
  PreviewCredentialKind,
  PreviewCredentialRecord,
  PreviewExpectation,
} from '../types/preview'

const LIFETIME_SECONDS: Record<PreviewCredentialKind, number> = {
  token: PREVIEW_TOKEN_TTL_SECONDS,
  grant: PREVIEW_GRANT_TTL_SECONDS,
}

/** The hash a credential is stored and looked up by: SHA-256 of its value, in hex. */
export function hashCredential(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Makes a preview token or grant: a random, opaque value and the record to store for it.
 *
 * @remarks
 * The value is 256 random bits, not a JWT and not derived from the binding. The record holds only
 * its hash, so a read of the store cannot replay a credential. The caller hands out `value` once
 * and never logs it.
 *
 * @param now - The moment of issue; the credential expires 60 s later for a token and 15 min
 * later for a grant.
 */
export function issueCredential(
  kind: PreviewCredentialKind,
  binding: PreviewBinding,
  now: Date = new Date()
): { value: string; record: PreviewCredentialRecord } {
  const value = randomBytes(32).toString('base64url')
  const record: PreviewCredentialRecord = {
    ...binding,
    kind,
    hash: hashCredential(value),
    expiresAt: new Date(now.getTime() + LIFETIME_SECONDS[kind] * 1000),
    usedAt: null,
    revokedAt: null,
  }
  return { value, record }
}

/**
 * Whether a stored credential may be used for what a request asks.
 *
 * @remarks
 * One answer for every reason: an unknown, used, revoked, expired or wrong-kind credential, and
 * one of another site, document or locale, are all `false`, so a refusal names nothing. Only the
 * fields present in `expected` are compared; `entryLocale` compares `null` too.
 */
export function mayUseCredential(
  record: PreviewCredentialRecord | null | undefined,
  kind: PreviewCredentialKind,
  expected: PreviewExpectation,
  now: Date = new Date()
): boolean {
  if (!record || record.kind !== kind) return false
  if (record.usedAt !== null || record.revokedAt !== null) return false
  if (record.expiresAt.getTime() <= now.getTime()) return false
  if (record.siteDocumentId !== expected.siteDocumentId) return false
  if (
    expected.entryDocumentId !== undefined &&
    record.entryDocumentId !== expected.entryDocumentId
  ) {
    return false
  }
  return expected.entryLocale === undefined || record.entryLocale === expected.entryLocale
}
