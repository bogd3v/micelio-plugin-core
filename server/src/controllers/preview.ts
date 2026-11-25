import type { Core, UID } from '@strapi/strapi'
import { errors } from '@strapi/utils'
import type { Context } from 'koa'
import accentOverrideSchema from '../components/site/accent-override.json'
import themeSchema from '../components/site/theme.json'
import {
  PREVIEW_ACCENT_OVERRIDES_MAX,
  PREVIEW_EXCHANGE_RATE_LIMIT,
  PREVIEW_GRANT_HEADER,
  PREVIEW_PERMISSION,
  PREVIEW_RATE_WINDOW_SECONDS,
  PREVIEW_TOKEN_RATE_LIMIT,
} from '../constants/preview'
import { REUSABLE_BLOCK_UID } from '../constants/reusable-blocks'
import { readableDraft, type UserAbility } from '../preview/access'
import { readDraft, readDraftQuery } from '../preview/draft-query'
import { referenceFields, reusableBlockDraftVersion, storedReferences } from '../reusable-blocks'
import type { SiteScopeState } from '../site-scope'
import { PreviewUnavailableError, type PreviewService } from '../services/preview'
import type {
  PreviewOverrides,
  PreviewResolvedGrant,
  PreviewReusableBlockVersion,
} from '../types/preview'
import { createRateLimiter } from '../utils/rate-limit'
import { sendProblem } from '../utils/problem'

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  429: 'Too Many Requests',
}

/**
 * The grammar of a preview override: the regexes of the site's theme and accent override
 * components, read from their schemas so the two never drift (ADR-0019, amendment of 2026-11-25).
 */
const THEME_ID = new RegExp(themeSchema.attributes.themeId.regex)
const THEME_VERSION = new RegExp(themeSchema.attributes.themeVersion.regex)
const ACCENT_MODE = new RegExp(accentOverrideSchema.attributes.mode.regex)
const ACCENT_COLOR = new RegExp(accentOverrideSchema.attributes.color.regex)

/** One answer for every refusal of a token or a grant, so it names nothing. */
const REFUSED = 'There is nothing to preview with this credential.'

interface ApiAuth {
  credentials?: { id?: number }
}

/** The handlers of the preview routes. */
export interface PreviewController {
  token(ctx: Context): Promise<void>
  exchange(ctx: Context): Promise<void>
  draft(ctx: Context): Promise<void>
}

/**
 * The preview routes (ADR-0019, section 3): `POST /micelio/preview/token` for an admin user,
 * `POST /api/micelio/preview/exchange` and `GET /api/micelio/preview/draft` for the frontend's API token.
 * `docs/api.md` describes them.
 */
export default ({ strapi }: { strapi: Core.Strapi }): PreviewController => {
  const previews = () => strapi.plugin('micelio').service('preview') as PreviewService
  const tokenLimit = createRateLimiter(PREVIEW_TOKEN_RATE_LIMIT, PREVIEW_RATE_WINDOW_SECONDS)
  const exchangeLimit = createRateLimiter(PREVIEW_EXCHANGE_RATE_LIMIT, PREVIEW_RATE_WINDOW_SECONDS)

  /**
   * Whether the draft is still the version a system grant was minted for. The version is read on
   * its own, after the draft, so what the answer holds never decides it.
   */
  async function isVersionOf(
    uid: UID.ContentType,
    binding: PreviewResolvedGrant
  ): Promise<boolean> {
    const current = (await strapi.documents(uid).findOne({
      documentId: binding.entryDocumentId,
      locale: binding.entryLocale ?? undefined,
      status: 'draft',
      fields: ['updatedAt'],
    } as never)) as { updatedAt?: string | Date } | null
    if (!current?.updatedAt || !binding.entryVersion) return false
    return new Date(current.updatedAt).getTime() === new Date(binding.entryVersion).getTime()
  }

  /**
   * Whether the page's published version, in the grant's locale, still references the grant's
   * reusable block, and the block's draft is still the version the grant names. Read after the
   * page, so a save of the block between the claim and the read is not served.
   */
  async function isReferenceOf(
    uid: UID.ContentType,
    binding: PreviewResolvedGrant & { reusableBlock: PreviewReusableBlockVersion }
  ): Promise<boolean> {
    const fields = referenceFields(strapi).filter((field) => field.uid === uid)
    const references = await storedReferences(strapi, uid, fields, {
      documentId: binding.entryDocumentId,
      locale: binding.entryLocale ?? undefined,
      published: true,
    })
    if (!references.includes(binding.reusableBlock.documentId)) return false
    const current = await reusableBlockDraftVersion(strapi, {
      documentId: binding.reusableBlock.documentId,
      locale: binding.entryLocale,
      siteDocumentId: binding.siteDocumentId,
    })
    return (
      current !== undefined &&
      new Date(current).getTime() === new Date(binding.reusableBlock.version).getTime()
    )
  }

  return {
    async token(ctx: Context): Promise<void> {
      const ability = ctx.state.userAbility as UserAbility | undefined
      const adminUser = (ctx.state.user as { id?: number } | undefined)?.id
      if (typeof adminUser !== 'number' || ability?.can(PREVIEW_PERMISSION) !== true) {
        refuse(
          ctx,
          403,
          'previewForbidden',
          `Previewing needs the permission ${PREVIEW_PERMISSION}.`
        )
        return
      }
      if (limited(ctx, tokenLimit.hit(`admin-user:${adminUser}`))) return
      const body = readTokenBody(ctx.request.body)
      if (!body) {
        refuse(
          ctx,
          400,
          'previewRequestInvalid',
          'The body needs uid and documentId as strings; locale is a string or null; theme is ' +
            `{ id, version } and accentOverrides at most ${PREVIEW_ACCENT_OVERRIDES_MAX} ` +
            '{ mode, color } with distinct modes, in the grammar of the site theme'
        )
        return
      }
      const access = await readableDraft(
        strapi,
        ctx.state.userAbility,
        body.uid,
        body.documentId,
        body.locale
      )
      if (access.status === 'not-site-scoped') {
        refuse(ctx, 400, 'previewTypeInvalid', `${body.uid} is not a type that belongs to a site`)
        return
      }
      if (access.status === 'missing') {
        refuse(ctx, 404, 'previewEntryNotFound', 'There is no such entry')
        return
      }
      if (access.status === 'forbidden') {
        refuse(
          ctx,
          403,
          'previewForbidden',
          'You may not read this entry, so you may not preview it'
        )
        return
      }
      try {
        const answer = await previews().issueToken({
          adminUser,
          adminOrigin: originOf(ctx),
          siteDocumentId: access.draft.siteDocumentId,
          contentType: body.uid,
          entryDocumentId: body.documentId,
          // The locale found, not the one asked: a request without `locale` gets the default one.
          entryLocale: access.draft.locale,
          ...(body.overrides ? { overrides: body.overrides } : {}),
        })
        // The URL carries the token: no cache keeps it.
        ctx.set('Cache-Control', 'private, no-store')
        ctx.body = { data: answer }
      } catch (error) {
        if (!(error instanceof PreviewUnavailableError)) throw error
        refuse(ctx, 409, 'previewUnavailable', error.message)
      }
    },

    async exchange(ctx: Context): Promise<void> {
      if (limited(ctx, exchangeLimit.hit(`api-token:${apiTokenId(ctx)}`))) return
      const token = (ctx.request.body as { token?: unknown } | undefined)?.token
      if (typeof token !== 'string' || token === '') {
        refuse(ctx, 400, 'previewRequestInvalid', 'The body needs a token as a string')
        return
      }
      const answer = await previews().exchange(token, siteOf(ctx))
      if (!answer) {
        refuse(ctx, 404, 'previewRefused', REFUSED)
        return
      }
      ctx.set('Cache-Control', 'private, no-store')
      ctx.body = { data: answer }
    },

    async draft(ctx: Context): Promise<void> {
      const grant = ctx.get(PREVIEW_GRANT_HEADER)
      const { documentId, locale, ...query } = ctx.query as Record<string, unknown>
      if (grant === '' || typeof documentId !== 'string' || typeof locale === 'object') {
        refuse(
          ctx,
          400,
          'previewRequestInvalid',
          `The request needs the ${PREVIEW_GRANT_HEADER} header and documentId`
        )
        return
      }
      const binding = await previews().resolveGrant(grant, {
        siteDocumentId: siteOf(ctx),
        entryDocumentId: documentId,
        entryLocale: locale === undefined ? undefined : String(locale),
      })
      if (!binding) {
        refuse(ctx, 404, 'previewRefused', REFUSED)
        return
      }
      const uid = binding.contentType as UID.ContentType
      const schema = strapi.contentType(uid)
      // Only a grant bound to a reference may populate the reusable block it serves as a draft.
      const read = readDraftQuery(
        strapi,
        query,
        schema,
        binding.reusableBlock ? (REUSABLE_BLOCK_UID as UID.ContentType) : undefined
      )
      if ('problem' in read) {
        refuse(ctx, 400, 'previewRequestInvalid', read.problem)
        return
      }
      const auth = ctx.state.auth
      const { reusableBlock } = binding
      const grantLocale = binding.entryLocale ?? undefined
      let entry
      try {
        entry = await readDraft(strapi, {
          uid,
          documentId: binding.entryDocumentId,
          locale: grantLocale,
          populate: read.populate,
          siteDocumentId: siteOf(ctx),
          auth,
          // A grant bound to a reference reads the page as published, with the block's draft in place.
          ...(reusableBlock
            ? {
                status: 'published' as const,
                draftReference: {
                  uid: REUSABLE_BLOCK_UID as UID.ContentType,
                  documentId: reusableBlock.documentId,
                  locale: grantLocale,
                },
              }
            : {}),
        })
      } catch (error) {
        // The query passed the allowlist and Strapi still refuses it: that is the client's, not a 500.
        if (!(error instanceof errors.ValidationError || error instanceof errors.PaginationError)) {
          throw error
        }
        refuse(ctx, 400, 'previewRequestInvalid', error.message)
        return
      }
      const isCurrent = async (): Promise<boolean> =>
        reusableBlock
          ? isReferenceOf(uid, { ...binding, reusableBlock })
          : binding.actor !== 'system' || isVersionOf(uid, binding)
      if (!entry || !(await isCurrent())) {
        refuse(ctx, 404, 'previewRefused', REFUSED)
        return
      }
      ctx.set('Cache-Control', 'private, no-store')
      ctx.body = {
        data: await strapi.contentAPI.sanitize.output(entry, schema, { auth }),
        meta: reusableBlock
          ? { actor: binding.actor, measure: 'reference', reusableBlock }
          : {
              actor: binding.actor,
              ...(binding.overrides ? { overrides: binding.overrides } : {}),
            },
      }
    },
  }
}

function refuse(ctx: Context, status: number, code: string, detail: string): void {
  sendProblem(ctx, { type: 'about:blank', title: TITLES[status] ?? 'Error', status, detail, code })
}

/** Answers `429` when the key is over its limit; `true` when it did. */
function limited(ctx: Context, retryAfterSeconds: number): boolean {
  if (retryAfterSeconds === 0) return false
  ctx.set('Retry-After', String(retryAfterSeconds))
  refuse(ctx, 429, 'previewRateLimited', 'Too many preview requests; try again later')
  return true
}

/** The site the `site-scope` middleware resolved; the routes that call it carry the middleware. */
function siteOf(ctx: Context): string {
  const site = (ctx.state as SiteScopeState).micelio?.site
  if (!site) throw new Error('micelio: a preview route ran without the site-scope middleware')
  return site.documentId
}

function apiTokenId(ctx: Context): number | string {
  return (ctx.state.auth as ApiAuth | undefined)?.credentials?.id ?? 'unknown'
}

/** The origin of the admin page that asks: its `Origin` header, else the origin of the request. */
function originOf(ctx: Context): string {
  return ctx.get('origin') || ctx.request.origin
}

interface TokenBody {
  uid: string
  documentId: string
  locale: string | null | undefined
  overrides?: PreviewOverrides
}

function readTokenBody(body: unknown): TokenBody | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { uid, documentId, locale, theme, accentOverrides } = body as Record<string, unknown>
  if (typeof uid !== 'string' || typeof documentId !== 'string') return undefined
  if (locale !== undefined && locale !== null && typeof locale !== 'string') return undefined
  const overrides = readOverrides(theme, accentOverrides)
  if (overrides === false) return undefined
  return { uid, documentId, locale, ...(overrides ? { overrides } : {}) }
}

/**
 * The override of a token body, checked against its grammar only: `undefined` when the body has
 * none, `false` when a field has another key or a value outside the grammar.
 */
function readOverrides(
  theme: unknown,
  accentOverrides: unknown
): PreviewOverrides | undefined | false {
  const overrides: PreviewOverrides = {}
  if (theme !== undefined) {
    if (!hasOnlyKeys(theme, ['id', 'version'])) return false
    const { id, version } = theme as Record<string, unknown>
    if (!matches(id, THEME_ID) || !matches(version, THEME_VERSION)) return false
    overrides.theme = { id, version }
  }
  if (accentOverrides !== undefined) {
    if (!Array.isArray(accentOverrides)) return false
    if (accentOverrides.length > PREVIEW_ACCENT_OVERRIDES_MAX) return false
    const modes = new Set<string>()
    const accents = []
    for (const accent of accentOverrides as unknown[]) {
      if (!hasOnlyKeys(accent, ['mode', 'color'])) return false
      const { mode, color } = accent as Record<string, unknown>
      if (!matches(mode, ACCENT_MODE) || !matches(color, ACCENT_COLOR)) return false
      if (modes.has(mode)) return false
      modes.add(mode)
      accents.push({ mode, color })
    }
    overrides.accentOverrides = accents
  }
  return theme === undefined && accentOverrides === undefined ? undefined : overrides
}

/** Whether a value is a plain object whose keys are all among `keys`. */
function hasOnlyKeys(value: unknown, keys: string[]): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.keys(value).every((key) => keys.includes(key))
}

function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value)
}
