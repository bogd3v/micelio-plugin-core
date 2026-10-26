import type { Core } from '@strapi/strapi'
import {
  PREVIEW_CREDENTIAL_RETENTION_SECONDS,
  PREVIEW_CREDENTIAL_UID,
  PREVIEW_PATH,
} from '../constants/preview'
import { SITE_UID } from '../constants/site'
import { abilityOf, readableDraft } from '../preview/access'
import { hashCredential, issueCredential, mayUseCredential } from '../preview/credentials'
import type {
  PreviewBinding,
  PreviewCredentialKind,
  PreviewCredentialRecord,
  PreviewExpectation,
  PreviewGrantAnswer,
  PreviewResolvedGrant,
  PreviewSystemBinding,
  PreviewTarget,
  PreviewTokenAnswer,
} from '../types/preview'

/** The `preview` service: `strapi.plugin('micelio').service('preview')`, behind the preview routes. */
export interface PreviewService {
  /**
   * Makes a preview token for a draft and the frontend URL that carries it.
   *
   * @remarks
   * The caller has already checked that the admin user may read the draft. The token is stored
   * hashed; expired credentials past their retention are removed on the way.
   *
   * @throws {@link PreviewUnavailableError} when the site has no `url`.
   */
  issueToken(binding: PreviewBinding): Promise<PreviewTokenAnswer>

  /**
   * Exchanges a preview token for a grant, and uses the token up.
   *
   * @returns The grant, or `null` for every refusal: the token is unknown, used, expired,
   * revoked or of another site, or the admin user may no longer read the draft.
   */
  exchange(token: string, siteDocumentId: string): Promise<PreviewGrantAnswer | null>

  /**
   * Makes a system grant for one version of a draft, and returns its value once.
   *
   * @remarks
   * For plugin code that measures a draft at publish (ADR-0019, amendment of 2026-10-25); no
   * route mints one. The grant lives 60 s, is used once, is bound to the site, type, document,
   * locale and `binding.entryVersion`, and has no admin user. It is stored hashed; expired
   * credentials past their retention are removed on the way. The caller sends it to the
   * frontend's weight route only, never to a browser, and never logs it.
   */
  issueSystemGrant(binding: PreviewSystemBinding): Promise<string>

  /**
   * What a usable grant names and who it acts for, or `null` for every refusal.
   *
   * @remarks
   * An `admin` grant checks again that the admin user may read the draft; when they may not,
   * every grant of that user and draft is revoked. A `system` grant is claimed with one
   * conditional update, so of two checks at once one finds it spent, and it has no user to ask.
   * Whether the draft is still the version the system grant was minted for is for the caller to
   * check (`entryVersion`).
   */
  resolveGrant(grant: string, expected: PreviewExpectation): Promise<PreviewResolvedGrant | null>

  /**
   * Revokes every unexpired token and grant of an admin user, or only those of one draft.
   *
   * @remarks
   * System grants have no admin user, so this never touches one: 60 s and a single use bound them.
   */
  revoke(adminUser: number, entryDocumentId?: string): Promise<void>
}

/** The site of a preview has no frontend origin: the token route answers `409` `previewUnavailable`. */
export class PreviewUnavailableError extends Error {
  constructor(site: string) {
    super(`The site ${site} has no url, so there is no frontend to preview on`)
    this.name = 'PreviewUnavailableError'
  }
}

type CredentialRow = Omit<PreviewCredentialRecord, 'expiresAt' | 'usedAt' | 'revokedAt'> & {
  id: number
  expiresAt: string | Date
  usedAt: string | Date | null
  revokedAt: string | Date | null
}

export default ({ strapi }: { strapi: Core.Strapi }): PreviewService => {
  const store = () => strapi.db.query(PREVIEW_CREDENTIAL_UID)

  async function save(record: PreviewCredentialRecord): Promise<void> {
    // The store is read through `strapi.db.query`, so only the create names the site.
    const site = (await strapi.db
      .query(SITE_UID)
      .findOne({ where: { documentId: record.siteDocumentId }, select: ['id'] })) as {
      id: number
    } | null
    await store().create({ data: { ...record, site: site?.id } })
  }

  async function find(
    kinds: PreviewCredentialKind[],
    value: string
  ): Promise<CredentialRow | null> {
    const row = (await store().findOne({
      where: { hash: hashCredential(value), kind: { $in: kinds } },
    })) as CredentialRow | null
    return row
  }

  async function removeExpired(): Promise<void> {
    await store().deleteMany({
      where: {
        expiresAt: { $lt: new Date(Date.now() - PREVIEW_CREDENTIAL_RETENTION_SECONDS * 1000) },
      },
    })
  }

  async function revoke(adminUser: number, entryDocumentId?: string): Promise<void> {
    await store().updateMany({
      where: {
        adminUser,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
        ...(entryDocumentId ? { entryDocumentId } : {}),
      },
      data: { revokedAt: new Date() },
    })
  }

  /** Whether the row's admin user may still read its draft; when not, revokes their credentials of that draft. */
  async function stillReadable(row: PreviewBinding): Promise<boolean> {
    const ability = await abilityOf(strapi, row.adminUser)
    const access = ability
      ? await readableDraft(strapi, ability, row.contentType, row.entryDocumentId, row.entryLocale)
      : null
    if (access?.status === 'ok' && access.draft.siteDocumentId === row.siteDocumentId) return true
    await revoke(row.adminUser, row.entryDocumentId)
    return false
  }

  return {
    async issueToken(binding) {
      const site = (await strapi.db
        .query(SITE_UID)
        .findOne({ where: { documentId: binding.siteDocumentId }, select: ['url'] })) as {
        url?: string | null
      } | null
      const url = previewUrlOf(site?.url)
      if (!url) throw new PreviewUnavailableError(binding.siteDocumentId)
      await removeExpired()
      const { value, record } = issueCredential('token', binding)
      await save(record)
      url.searchParams.set('token', value)
      return { url: url.toString(), expiresAt: record.expiresAt.toISOString() }
    },

    async exchange(token, siteDocumentId) {
      const row = await find(['token'], token)
      if (!row || !mayUseCredential(toRecord(row), 'token', { siteDocumentId })) return null
      // The claim is one conditional update: of two exchanges at once, one finds no unused row.
      const claimed = (await store().updateMany({
        where: { id: row.id, usedAt: null, revokedAt: null },
        data: { usedAt: new Date() },
      })) as { count: number }
      if (claimed.count !== 1) return null
      const binding = adminBindingOf(row)
      if (!binding || !(await stillReadable(binding))) return null
      const { value, record } = issueCredential('grant', binding)
      await save(record)
      return {
        grant: value,
        expiresAt: record.expiresAt.toISOString(),
        adminOrigin: binding.adminOrigin,
        contentType: row.contentType,
        documentId: row.entryDocumentId,
        locale: row.entryLocale,
      }
    },

    async issueSystemGrant(binding) {
      await removeExpired()
      const { value, record } = issueCredential('system', binding)
      await save(record)
      return value
    },

    async resolveGrant(grant, expected) {
      const row = await find(['grant', 'system'], grant)
      if (!row || !mayUseCredential(toRecord(row), row.kind, expected)) return null
      if (row.kind === 'system') {
        // The claim is one conditional update: of two checks at once, one finds no unused row.
        const claimed = (await store().updateMany({
          where: { id: row.id, usedAt: null, revokedAt: null },
          data: { usedAt: new Date() },
        })) as { count: number }
        if (claimed.count !== 1) return null
        return { ...targetOf(row), actor: 'system', entryVersion: row.entryVersion }
      }
      const binding = adminBindingOf(row)
      if (!binding || !(await stillReadable(binding))) return null
      return { ...targetOf(row), actor: 'admin', entryVersion: null }
    },

    revoke,
  }
}

/** `<url>/_preview` for a site's `url`, or `undefined` when it has none. */
function previewUrlOf(url: string | null | undefined): URL | undefined {
  if (!url) return undefined
  try {
    const target = new URL(url)
    target.pathname = `${target.pathname.replace(/\/+$/, '')}${PREVIEW_PATH}`
    target.search = ''
    target.hash = ''
    return target
  } catch {
    // The site's regex refuses such a value; a row that has one has no frontend origin.
    return undefined
  }
}

function targetOf(row: PreviewTarget): PreviewTarget {
  return {
    siteDocumentId: row.siteDocumentId,
    contentType: row.contentType,
    entryDocumentId: row.entryDocumentId,
    entryLocale: row.entryLocale,
  }
}

/** The binding of a token or grant row; `null` for a row without an admin user or origin, which no token or grant is. */
function adminBindingOf(row: CredentialRow): PreviewBinding | null {
  if (row.adminUser === null || row.adminOrigin === null) return null
  return { ...targetOf(row), adminUser: row.adminUser, adminOrigin: row.adminOrigin }
}

function toRecord(row: CredentialRow): PreviewCredentialRecord {
  return {
    ...targetOf(row),
    kind: row.kind,
    hash: row.hash,
    adminUser: row.adminUser,
    adminOrigin: row.adminOrigin,
    entryVersion: row.entryVersion,
    expiresAt: new Date(row.expiresAt),
    usedAt: row.usedAt ? new Date(row.usedAt) : null,
    revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
  }
}
