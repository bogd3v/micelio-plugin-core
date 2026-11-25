import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  PREVIEW_GRANT_TTL_SECONDS,
  PREVIEW_SYSTEM_GRANT_TTL_SECONDS,
  PREVIEW_TOKEN_TTL_SECONDS,
} from '../server/src/constants/preview'
import {
  bindingOf,
  hashCredential,
  issueCredential,
  mayUseCredential,
  overridesOf,
} from '../server/src/preview/credentials'
import type { PreviewBinding, PreviewSystemBinding } from '../server/src/types/preview'

const BINDING: PreviewBinding = {
  adminUser: 7,
  adminOrigin: 'https://admin.example.com',
  siteDocumentId: 'site-a',
  contentType: 'api::article.article',
  entryDocumentId: 'doc-1',
  entryLocale: 'en',
}
const SYSTEM_BINDING: PreviewSystemBinding = {
  siteDocumentId: 'site-a',
  contentType: 'api::article.article',
  entryDocumentId: 'doc-1',
  entryLocale: 'en',
  entryVersion: '2026-10-25T11:59:00.000Z',
}
const NOW = new Date('2026-10-25T12:00:00.000Z')
const after = (seconds: number) => new Date(NOW.getTime() + seconds * 1000)

describe('a preview credential', () => {
  it('is random, opaque and stored only as the hash of its value', () => {
    const first = issueCredential('token', BINDING, NOW)
    const second = issueCredential('token', BINDING, NOW)
    expect(first.value).not.toBe(second.value)
    // 256 random bits as base64url: no dots, so it is not a JWT, and nothing of the binding in it.
    expect(first.value).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.value).not.toContain('doc-1')
    expect(first.record.hash).toBe(createHash('sha256').update(first.value).digest('hex'))
    expect(first.record.hash).toBe(hashCredential(first.value))
    expect(JSON.stringify(first.record)).not.toContain(first.value)
  })

  it('is bound to the admin user, origin, site, type, document and locale', () => {
    const { record } = issueCredential('grant', BINDING, NOW)
    expect(record).toMatchObject(BINDING)
  })

  it('copies the overrides of a token to its grant, and binds none by default', () => {
    const overrides: NonNullable<PreviewBinding['overrides']> = {
      theme: { id: 'sendero', version: '1.2.0' },
      accentOverrides: [
        { mode: 'light', color: '#1A2B3C' },
        { mode: 'dark', color: '#ffeedd' },
      ],
    }
    const token = issueCredential('token', { ...BINDING, overrides }, NOW).record
    // Stored as given, next to the other bindings, and not hashed.
    expect(token).toMatchObject({ ...BINDING, ...overrides })
    expect(overridesOf(token)).toEqual(overrides)
    // The exchange issues the grant from the token's binding: the same override.
    const grant = issueCredential('grant', bindingOf(token)!, NOW).record
    expect(grant).toMatchObject({ kind: 'grant', ...BINDING, ...overrides })
    expect(overridesOf(grant)).toEqual(overrides)
    // Either field alone is carried alone.
    const themeOnly = issueCredential(
      'token',
      { ...BINDING, overrides: { theme: overrides.theme } },
      NOW
    )
    expect(bindingOf(themeOnly.record)?.overrides).toEqual({ theme: overrides.theme })
    const accentsOnly = { accentOverrides: overrides.accentOverrides }
    const accentToken = issueCredential('token', { ...BINDING, overrides: accentsOnly }, NOW)
    expect(bindingOf(accentToken.record)?.overrides).toEqual(accentsOnly)
    // A token asked without one, its grant and a system grant bind none.
    const plain = issueCredential('token', BINDING, NOW).record
    const plainGrant = issueCredential('grant', bindingOf(plain)!, NOW).record
    const system = issueCredential('system', SYSTEM_BINDING, NOW).record
    for (const record of [plain, plainGrant, system]) {
      expect(record).not.toHaveProperty('theme')
      expect(record).not.toHaveProperty('accentOverrides')
      expect(overridesOf(record)).toBeNull()
    }
    expect(bindingOf(plain)).toEqual(BINDING)
    expect(bindingOf(system)).toBeNull()
  })

  it('lives 60 seconds as a token and 15 minutes as a grant', () => {
    expect(PREVIEW_TOKEN_TTL_SECONDS).toBe(60)
    expect(PREVIEW_GRANT_TTL_SECONDS).toBe(15 * 60)
    expect(issueCredential('token', BINDING, NOW).record.expiresAt).toEqual(after(60))
    expect(issueCredential('grant', BINDING, NOW).record.expiresAt).toEqual(after(15 * 60))
  })
})

describe('using a preview credential', () => {
  const expected = { siteDocumentId: 'site-a' }

  it('accepts a token until it expires after 60 seconds', () => {
    const { record } = issueCredential('token', BINDING, NOW)
    expect(mayUseCredential(record, 'token', expected, after(59))).toBe(true)
    expect(mayUseCredential(record, 'token', expected, after(60))).toBe(false)
    expect(mayUseCredential(record, 'token', expected, after(61))).toBe(false)
  })

  it('accepts a grant until it expires after 15 minutes', () => {
    const { record } = issueCredential('grant', BINDING, NOW)
    expect(mayUseCredential(record, 'grant', expected, after(14 * 60 + 59))).toBe(true)
    expect(mayUseCredential(record, 'grant', expected, after(15 * 60 + 1))).toBe(false)
  })

  it('refuses a token that was already used, and a revoked one', () => {
    const { record } = issueCredential('token', BINDING, NOW)
    expect(mayUseCredential({ ...record, usedAt: NOW }, 'token', expected, after(1))).toBe(false)
    expect(mayUseCredential({ ...record, revokedAt: NOW }, 'token', expected, after(1))).toBe(false)
  })

  it('refuses a token as a grant and a grant as a token', () => {
    const token = issueCredential('token', BINDING, NOW).record
    const grant = issueCredential('grant', BINDING, NOW).record
    expect(mayUseCredential(token, 'grant', expected, after(1))).toBe(false)
    expect(mayUseCredential(grant, 'token', expected, after(1))).toBe(false)
  })

  it.each(['token', 'grant'] as const)(
    'refuses a %s of another site, document or locale',
    (kind) => {
      const { record } = issueCredential(kind, BINDING, NOW)
      const at = after(1)
      expect(
        mayUseCredential(record, kind, { siteDocumentId: 'site-a', entryDocumentId: 'doc-1' }, at)
      ).toBe(true)
      expect(mayUseCredential(record, kind, { siteDocumentId: 'site-b' }, at)).toBe(false)
      expect(
        mayUseCredential(record, kind, { siteDocumentId: 'site-a', entryDocumentId: 'doc-2' }, at)
      ).toBe(false)
      expect(
        mayUseCredential(record, kind, { siteDocumentId: 'site-a', entryLocale: 'es' }, at)
      ).toBe(false)
      expect(
        mayUseCredential(record, kind, { siteDocumentId: 'site-a', entryLocale: null }, at)
      ).toBe(false)
    }
  )

  it('compares an unlocalised draft with null', () => {
    const { record } = issueCredential('grant', { ...BINDING, entryLocale: null }, NOW)
    expect(mayUseCredential(record, 'grant', { ...expected, entryLocale: null }, after(1))).toBe(
      true
    )
    expect(mayUseCredential(record, 'grant', { ...expected, entryLocale: 'en' }, after(1))).toBe(
      false
    )
  })

  it('answers the same for every reason and for an unknown credential', () => {
    const { record } = issueCredential('token', BINDING, NOW)
    const refusals = [
      mayUseCredential(null, 'token', expected, after(1)),
      mayUseCredential(undefined, 'token', expected, after(1)),
      mayUseCredential(record, 'token', expected, after(61)),
      mayUseCredential({ ...record, usedAt: NOW }, 'token', expected, after(1)),
      mayUseCredential(record, 'token', { siteDocumentId: 'site-b' }, after(1)),
      mayUseCredential(record, 'token', { ...expected, entryDocumentId: 'doc-2' }, after(1)),
    ]
    expect(new Set(refusals)).toEqual(new Set([false]))
  })
})

describe('a system grant', () => {
  const expected = { siteDocumentId: 'site-a', entryDocumentId: 'doc-1', entryLocale: 'en' }

  it('lives 60 seconds', () => {
    expect(PREVIEW_SYSTEM_GRANT_TTL_SECONDS).toBe(60)
    const { record } = issueCredential('system', SYSTEM_BINDING, NOW)
    expect(record.expiresAt).toEqual(after(60))
    expect(mayUseCredential(record, 'system', expected, after(59))).toBe(true)
    expect(mayUseCredential(record, 'system', expected, after(60))).toBe(false)
  })

  it('has no admin user or origin, holds the version and is stored only as a hash', () => {
    const { value, record } = issueCredential('system', SYSTEM_BINDING, NOW)
    expect(record).toMatchObject({
      kind: 'system',
      adminUser: null,
      adminOrigin: null,
      entryVersion: SYSTEM_BINDING.entryVersion,
      usedAt: null,
      revokedAt: null,
    })
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(record.hash).toBe(hashCredential(value))
    expect(JSON.stringify(record)).not.toContain(value)
  })

  it('keeps no version on a token or a grant', () => {
    expect(issueCredential('grant', BINDING, NOW).record.entryVersion).toBeNull()
  })

  it('is refused as a token and as a grant, and they are refused as a system grant', () => {
    const system = issueCredential('system', SYSTEM_BINDING, NOW).record
    expect(mayUseCredential(system, 'token', expected, after(1))).toBe(false)
    expect(mayUseCredential(system, 'grant', expected, after(1))).toBe(false)
    for (const kind of ['token', 'grant'] as const) {
      const record = issueCredential(kind, BINDING, NOW).record
      expect(mayUseCredential(record, 'system', expected, after(1))).toBe(false)
    }
  })

  it('is refused once used, and for another site, document or locale', () => {
    const { record } = issueCredential('system', SYSTEM_BINDING, NOW)
    const at = after(1)
    expect(mayUseCredential({ ...record, usedAt: NOW }, 'system', expected, at)).toBe(false)
    expect(mayUseCredential(record, 'system', { ...expected, siteDocumentId: 'site-b' }, at)).toBe(
      false
    )
    expect(mayUseCredential(record, 'system', { ...expected, entryDocumentId: 'doc-2' }, at)).toBe(
      false
    )
    expect(mayUseCredential(record, 'system', { ...expected, entryLocale: 'es' }, at)).toBe(false)
  })
})

const REFERENCE_BINDING: PreviewSystemBinding = {
  siteDocumentId: 'site-a',
  contentType: 'api::page.page',
  entryDocumentId: 'page-1',
  entryLocale: 'en',
  reusableBlock: { documentId: 'block-1', version: '2026-11-23T09:00:00.000Z' },
}
const OWN_EXPECTED = { siteDocumentId: 'site-a', entryDocumentId: 'doc-1', entryLocale: 'en' }
const REFERENCE_EXPECTED = {
  siteDocumentId: 'site-a',
  entryDocumentId: 'page-1',
  entryLocale: 'en',
}

it('a system grant bound to a reference holds the reusable block and its version, and only its hash', () => {
  const { value, record } = issueCredential('system', REFERENCE_BINDING, NOW)
  expect(record).toEqual({
    kind: 'system',
    hash: hashCredential(value),
    adminUser: null,
    adminOrigin: null,
    siteDocumentId: 'site-a',
    contentType: 'api::page.page',
    entryDocumentId: 'page-1',
    entryLocale: 'en',
    // The page's own version is not bound: what is measured is what it publishes at the read.
    entryVersion: null,
    reusableBlockDocumentId: 'block-1',
    reusableBlockVersion: '2026-11-23T09:00:00.000Z',
    expiresAt: after(60),
    usedAt: null,
    revokedAt: null,
  })
  expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(value).not.toContain('block-1')
  expect(JSON.stringify(record)).not.toContain(value)
  // A system grant of a page's own draft and a token name no reusable block.
  for (const other of [
    issueCredential('system', SYSTEM_BINDING, NOW).record,
    issueCredential('token', BINDING, NOW).record,
  ]) {
    expect(other).toMatchObject({ reusableBlockDocumentId: null, reusableBlockVersion: null })
  }
})

it("a system grant bound to a reference is refused once the reusable block's version differs", () => {
  const { record } = issueCredential('system', REFERENCE_BINDING, NOW)
  const at = after(1)
  const use = (reusableBlockVersion?: string | null) =>
    mayUseCredential(record, 'system', { ...REFERENCE_EXPECTED, reusableBlockVersion }, at)
  expect(use('2026-11-23T09:00:00.000Z')).toBe(true)
  // The same instant written another way is the same version.
  expect(use('2026-11-23T09:00:00Z')).toBe(true)
  // The block's draft saved since, gone, or not looked up at all.
  expect(use('2026-11-23T09:00:00.001Z')).toBe(false)
  expect(use(null)).toBe(false)
  expect(use(undefined)).toBe(false)
  expect(use('not a date')).toBe(false)
  // The rules of every system grant still hold.
  const current = { ...REFERENCE_EXPECTED, reusableBlockVersion: '2026-11-23T09:00:00.000Z' }
  expect(mayUseCredential({ ...record, usedAt: NOW }, 'system', current, at)).toBe(false)
  expect(mayUseCredential(record, 'system', current, after(60))).toBe(false)
  expect(mayUseCredential(record, 'system', { ...current, entryLocale: 'es' }, at)).toBe(false)
  expect(mayUseCredential(record, 'grant', current, at)).toBe(false)
  // A version asked of a system grant that names no reusable block is not read.
  const own = issueCredential('system', SYSTEM_BINDING, NOW).record
  expect(
    mayUseCredential(own, 'system', { ...OWN_EXPECTED, reusableBlockVersion: 'not a date' }, at)
  ).toBe(true)
})
