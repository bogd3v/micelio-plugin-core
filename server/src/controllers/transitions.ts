import type { Core } from '@strapi/strapi'
import type { Context } from 'koa'
import {
  EDITORIAL_NOTE_MAX_LENGTH,
  EDITORIAL_STATES,
  REVIEW_READ_PERMISSION,
  type EditorialState,
} from '../constants/editorial'
import { TransitionError, type TransitionRequest } from '../editorial/transitions'
import { sendProblem } from '../utils/problem'

interface AdminUser {
  id: number
  roles?: { code: string }[]
}

interface PermissionChecker {
  cannot: Record<'read' | 'update' | 'publish', (entity: object, field?: string) => boolean>
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
}

interface Ability {
  can(action: string, subject?: string): boolean
}

/** `POST /micelio/transitions` and `GET /micelio/review`, for an admin user: see `docs/api.md`. */
export default ({
  strapi,
}: {
  strapi: Core.Strapi
}): { perform(ctx: Context): Promise<void>; inReview(ctx: Context): Promise<void> } => ({
  async inReview(ctx) {
    const ability = ctx.state.userAbility as Ability
    if (!ability.can(REVIEW_READ_PERMISSION)) {
      sendProblem(ctx, {
        type: 'about:blank',
        title: TITLES[403],
        status: 403,
        detail: `Reading the In review page needs the permission ${REVIEW_READ_PERMISSION}.`,
        code: 'reviewForbidden',
      })
      return
    }
    const checkers = new Map<string, PermissionChecker>()
    const checkerOf = (uid: string): PermissionChecker => {
      const checker =
        checkers.get(uid) ??
        (strapi
          .plugin('content-manager')
          .service('permission-checker')
          .create({ userAbility: ability, model: uid }) as PermissionChecker)
      checkers.set(uid, checker)
      return checker
    }
    // The type first, then each entry: the conditions of the permission (an author's own entries,
    // some locales) decide which entries of a type the caller sees, and its fields which values of
    // an entry it sees.
    const mayRead = (uid: string, entry?: object, field?: string): boolean =>
      entry === undefined
        ? ability.can('plugin::content-manager.explorer.read', uid)
        : !checkerOf(uid).cannot.read(entry, field)
    const data = await strapi.plugin('micelio').service('transitions').inReview(mayRead)
    ctx.body = { data }
  },

  async perform(ctx) {
    const body = readBody(ctx.request.body)
    if (!body) {
      sendProblem(ctx, {
        type: 'about:blank',
        title: TITLES[400],
        status: 400,
        detail: `The body needs uid, documentId and to; locale, publishAt, a note of at most ${EDITORIAL_NOTE_MAX_LENGTH} characters and dryRun are optional`,
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
        ...error.extensions,
      })
    }
  },
})

type TransitionBody = Omit<TransitionRequest, 'actor' | 'isPermitted'>

function readBody(body: unknown): TransitionBody | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { uid, documentId, to, locale, publishAt, note, dryRun } = body as Record<string, unknown>
  if (typeof uid !== 'string' || typeof documentId !== 'string') return undefined
  if (!EDITORIAL_STATES.includes(to as EditorialState)) return undefined
  if (locale !== undefined && typeof locale !== 'string') return undefined
  if (publishAt !== undefined && typeof publishAt !== 'string') return undefined
  if (note !== undefined && typeof note !== 'string') return undefined
  if (dryRun !== undefined && typeof dryRun !== 'boolean') return undefined
  return { uid, documentId, to: to as EditorialState, locale, publishAt, note, dryRun }
}
