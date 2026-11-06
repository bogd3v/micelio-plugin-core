import type { Core, Modules, UID } from '@strapi/strapi'
import { errors } from '@strapi/utils'
import { EDITORIAL_ATTRIBUTE } from '../constants/editorial'
import { isEditorial } from '.'
import { isInsideTransition } from './context'

type Params = Record<string, unknown> & {
  data?: Record<string, unknown>
  documentId?: string
  locale?: string
  status?: string
}

const PUBLISHING_ACTIONS = new Set(['publish', 'unpublish'])

/**
 * The document service middleware that keeps publishing in the hands of the transitions.
 *
 * @remarks
 * For a type made with `withEditorial`, outside a transition:
 * - `publish` and `unpublish` are refused, and so is a `create` or `update` that asks for the
 *   published status. This covers the Content Manager and the content API alike.
 * - A new entry starts in `draft`, whatever it was sent with.
 * - An update keeps the stored component: a different `state` is refused, and the other fields of
 *   the component, which the Content Manager sends back on every save, are left as they are.
 * - An update of a `scheduled` entry moves it back to `draft` and clears its `publishAt`: what was
 *   scheduled is not what would publish, so the editor schedules it again (issue #57). It is the
 *   edit itself, not a transition: it needs no role of the site's policy and fires no hook.
 */
export function editorialGuard(strapi: Core.Strapi): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    if (isInsideTransition() || !isEditorial(strapi.contentType(context.uid))) return next()
    const params = context.params as Params

    if (
      PUBLISHING_ACTIONS.has(context.action) ||
      ((context.action === 'create' || context.action === 'update') &&
        params.status === 'published')
    ) {
      throw new errors.ForbiddenError('Entries are published through the editorial transitions')
    }
    if (context.action === 'create') {
      const sent = params.data?.[EDITORIAL_ATTRIBUTE] as { state?: unknown } | null | undefined
      if (sent?.state !== undefined && sent.state !== 'draft') {
        throw new errors.ValidationError('A new entry starts in the draft editorial state')
      }
      params.data = { ...params.data, [EDITORIAL_ATTRIBUTE]: { state: 'draft' } }
    }
    if (context.action === 'update' && params.data) {
      const stored = await storedEditorial(strapi, context.uid, params)
      const data = { ...params.data }
      if (EDITORIAL_ATTRIBUTE in data) {
        const sent = data[EDITORIAL_ATTRIBUTE] as { state?: unknown } | null
        if (sent?.state !== undefined && sent.state !== (stored?.state ?? 'draft')) {
          throw new errors.ValidationError('The editorial state changes only through a transition')
        }
        delete data[EDITORIAL_ATTRIBUTE]
      }
      if (stored?.state === 'scheduled') {
        data[EDITORIAL_ATTRIBUTE] = {
          state: 'draft',
          publishAt: null,
          reviewedBy: stored.reviewedBy?.id ?? null,
          publishedBy: stored.publishedBy?.id ?? null,
          note: stored.note ?? null,
        }
      }
      params.data = data
    }
    return next()
  }
}

interface StoredEditorial {
  state?: string
  reviewedBy?: { id: number } | null
  publishedBy?: { id: number } | null
  note?: string | null
}

async function storedEditorial(
  strapi: Core.Strapi,
  uid: UID.ContentType,
  params: Params
): Promise<StoredEditorial | null> {
  const entry = (await strapi.documents(uid).findOne({
    documentId: params.documentId ?? '',
    locale: params.locale,
    status: 'draft',
    populate: { [EDITORIAL_ATTRIBUTE]: { populate: ['reviewedBy', 'publishedBy'] } },
  } as never)) as { editorial?: StoredEditorial | null } | null
  return entry?.editorial ?? null
}
