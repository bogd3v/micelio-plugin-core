import type { Core } from '@strapi/strapi'
import type { Context } from 'koa'
import { EDITORIAL_STATES, type EditorialState } from '../constants/editorial'
import { TransitionError, type TransitionRequest } from '../editorial/transitions'
import { sendProblem } from '../utils/problem'

interface AdminUser {
  id: number
  roles?: { code: string }[]
}

interface PermissionChecker {
  cannot: Record<'update' | 'publish', (entity: object) => boolean>
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
}

/** `POST /micelio/transitions`, for an admin user: see `docs/api.md`. */
export default ({ strapi }: { strapi: Core.Strapi }): { perform(ctx: Context): Promise<void> } => ({
  async perform(ctx) {
    const body = readBody(ctx.request.body)
    if (!body) {
      sendProblem(ctx, {
        type: 'about:blank',
        title: TITLES[400],
        status: 400,
        detail: 'The body needs uid, documentId and to; locale and publishAt are optional',
        code: 'editorialRequestInvalid',
      })
      return
    }
    const user = ctx.state.user as AdminUser
    const checker = strapi
      .plugin('content-manager')
      .service('permission-checker')
      .create({ userAbility: ctx.state.userAbility, model: body.uid }) as PermissionChecker
    try {
      const result = await strapi
        .plugin('micelio')
        .service('transitions')
        .perform({
          ...body,
          actor: { kind: 'user', id: user.id, roles: (user.roles ?? []).map((role) => role.code) },
          isPermitted: (action: 'update' | 'publish', entry: object) =>
            !checker.cannot[action](entry),
        })
      ctx.body = { data: result }
    } catch (error) {
      if (!(error instanceof TransitionError)) throw error
      sendProblem(ctx, {
        type: 'about:blank',
        title: TITLES[error.status] ?? 'Error',
        status: error.status,
        detail: error.message,
        code: error.code,
      })
    }
  },
})

type TransitionBody = Omit<TransitionRequest, 'actor' | 'isPermitted'>

function readBody(body: unknown): TransitionBody | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { uid, documentId, to, locale, publishAt } = body as Record<string, unknown>
  if (typeof uid !== 'string' || typeof documentId !== 'string') return undefined
  if (!EDITORIAL_STATES.includes(to as EditorialState)) return undefined
  if (locale !== undefined && typeof locale !== 'string') return undefined
  if (publishAt !== undefined && typeof publishAt !== 'string') return undefined
  return { uid, documentId, to: to as EditorialState, locale, publishAt }
}
