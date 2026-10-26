import type { Core, UID } from '@strapi/strapi'
import { errors } from '@strapi/utils'
import type { Context } from 'koa'
import {
  PREVIEW_EXCHANGE_RATE_LIMIT,
  PREVIEW_GRANT_HEADER,
  PREVIEW_PERMISSION,
  PREVIEW_RATE_WINDOW_SECONDS,
  PREVIEW_TOKEN_RATE_LIMIT,
} from '../constants/preview'
import { readableDraft, type UserAbility } from '../preview/access'
import { readDraft, readDraftQuery } from '../preview/draft-query'
import type { SiteScopeState } from '../site-scope'
import { PreviewUnavailableError, type PreviewService } from '../services/preview'
import type { PreviewResolvedGrant } from '../types/preview'
import { createRateLimiter } from '../utils/rate-limit'
import { sendProblem } from '../utils/problem'

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  429: 'Too Many Requests',
}

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
          'The body needs uid and documentId as strings; locale is a string or null'
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
      const read = readDraftQuery(strapi, query, schema)
      if ('problem' in read) {
        refuse(ctx, 400, 'previewRequestInvalid', read.problem)
        return
      }
      const auth = ctx.state.auth
      let entry
      try {
        entry = await readDraft(strapi, {
          uid,
          documentId: binding.entryDocumentId,
          locale: binding.entryLocale ?? undefined,
          populate: read.populate,
          siteDocumentId: siteOf(ctx),
          auth,
        })
      } catch (error) {
        // The query passed the allowlist and Strapi still refuses it: that is the client's, not a 500.
        if (!(error instanceof errors.ValidationError || error instanceof errors.PaginationError)) {
          throw error
        }
        refuse(ctx, 400, 'previewRequestInvalid', error.message)
        return
      }
      if (!entry || (binding.actor === 'system' && !(await isVersionOf(uid, binding)))) {
        refuse(ctx, 404, 'previewRefused', REFUSED)
        return
      }
      ctx.set('Cache-Control', 'private, no-store')
      ctx.body = {
        data: await strapi.contentAPI.sanitize.output(entry, schema, { auth }),
        meta: { actor: binding.actor },
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

function readTokenBody(
  body: unknown
): { uid: string; documentId: string; locale: string | null | undefined } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { uid, documentId, locale } = body as Record<string, unknown>
  if (typeof uid !== 'string' || typeof documentId !== 'string') return undefined
  if (locale !== undefined && locale !== null && typeof locale !== 'string') return undefined
  return { uid, documentId, locale }
}
