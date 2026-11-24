import { createHash, randomBytes } from 'node:crypto'
import {
  PREVIEW_GRANT_TTL_SECONDS,
  PREVIEW_SYSTEM_GRANT_TTL_SECONDS,
  PREVIEW_TOKEN_TTL_SECONDS,
} from '../constants/preview'
import type {
  PreviewBinding,
  PreviewCredentialKind,
  PreviewCredentialRecord,
  PreviewExpectation,
  PreviewSystemBinding,
} from '../types/preview'

const LIFETIME_SECONDS: Record<PreviewCredentialKind, number> = {
  token: PREVIEW_TOKEN_TTL_SECONDS,
  grant: PREVIEW_GRANT_TTL_SECONDS,
  system: PREVIEW_SYSTEM_GRANT_TTL_SECONDS,
}

/** The hash a credential is stored and looked up by: SHA-256 of its value, in hex. */
export function hashCredential(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Makes a preview token, grant or system grant: a random, opaque value and the record to store for it.
 *
 * @remarks
 * The value is 256 random bits, not a JWT and not derived from the binding. The record holds only
 * its hash, so a read of the store cannot replay a credential. The caller hands out `value` once
 * and never logs it.
 *
 * @param binding - An admin user's binding for a token or grant; a system grant's for `system`,
 * which has no admin user and holds the draft's version instead, or, bound to a reference, the
 * reusable block and the version of its draft.
 * @param now - The moment of issue; the credential expires 60 s later for a token or a system
 * grant and 15 min later for a grant.
 */
export function issueCredential(
  kind: PreviewCredentialKind,
  binding: PreviewBinding | PreviewSystemBinding,
  now: Date = new Date()
): { value: string; record: PreviewCredentialRecord } {
  const value = randomBytes(32).toString('base64url')
  const { reusableBlock, ...bound } = binding as PreviewSystemBinding
  const record: PreviewCredentialRecord = {
    adminUser: null,
    adminOrigin: null,
    ...bound,
    entryVersion: bound.entryVersion ?? null,
    reusableBlockDocumentId: reusableBlock?.documentId ?? null,
    reusableBlockVersion: reusableBlock?.version ?? null,
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
 * fields present in `expected` are compared; `entryLocale` compares `null` too. A system grant bound
 * to a reference is the exception: it is usable only while `expected.reusableBlockVersion` is the
 * version it was minted for, so a save of the block's draft since, or a missing version, refuses it.
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
  if (expected.entryLocale !== undefined && record.entryLocale !== expected.entryLocale) {
    return false
  }
  return (
    record.reusableBlockDocumentId == null ||
    isSameInstant(record.reusableBlockVersion, expected.reusableBlockVersion)
  )
}

/** Whether two dates name the same instant; `false` when either is missing or not a date. */
function isSameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return new Date(a).getTime() === new Date(b).getTime()
}
