import { createHash } from 'node:crypto'
import type { Core, UID } from '@strapi/strapi'
import type { Context } from 'koa'
import { REDIRECT_UID, REDIRECTS_MAX_AGE_SECONDS } from '../constants/page-settings'
import { isSitePath } from '../page-settings/redirects'
import type { SiteScopeState } from '../site-scope'

interface RedirectRow {
  from: string
  to: string
  entryLocale?: string | null
}

/** Whether an `If-None-Match` header names `etag` (weak comparison, as RFC 9110 asks for it) or `*`. */
function namesTag(header: string, etag: string): boolean {
  return header
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === '*' || tag === etag)
}

/**
 * `GET /api/micelio/redirects?site=<slug>`, for the frontend's API token: every 301 redirect of the
 * site (`docs/api.md`).
 *
 * @remarks
 * The answer is cacheable: it carries a strong `ETag` of its body and `Cache-Control` with
 * `public, max-age`, and a request whose `If-None-Match` names that tag gets `304` with no body (a `*` matches too).
 * A row whose `from` or `to` is not a path of the site is never served (it could only come from a write that bypassed the document service).
 * The list is in a fixed order, so the tag only changes when a redirect does.
 */
export default ({ strapi }: { strapi: Core.Strapi }): { find(ctx: Context): Promise<void> } => ({
  async find(ctx) {
    const site = (ctx.state as SiteScopeState).micelio?.site
    if (!site) throw new Error('micelio: the redirects route ran without the site-scope middleware')
    const rows = (await strapi.documents(REDIRECT_UID as UID.ContentType).findMany({
      filters: { site: { documentId: site.documentId } },
      fields: ['from', 'to', 'entryLocale'],
      sort: ['from:asc', 'entryLocale:asc'],
      limit: -1,
    } as never)) as unknown as RedirectRow[]
    const body = {
      data: rows
        .filter(({ from, to }) => isSitePath(from) && isSitePath(to))
        .map(({ from, to, entryLocale }) => ({ from, to, locale: entryLocale ?? null })),
    }
    const etag = `"${createHash('sha256').update(JSON.stringify(body)).digest('base64url')}"`
    ctx.set('ETag', etag)
    ctx.set('Cache-Control', `public, max-age=${REDIRECTS_MAX_AGE_SECONDS}`)
    if (namesTag(ctx.get('If-None-Match'), etag)) {
      ctx.status = 304
      return
    }
    ctx.body = body
  },
})
