import type { Core } from '@strapi/strapi'
import type { Context } from 'koa'
import { parseWeightReport } from '../budget/rules'
import { PREVIEW_PERMISSION } from '../constants/preview'
import { TransitionError } from '../editorial/transitions'
import { readableDraft, type UserAbility } from '../preview/access'
import type { BudgetService } from '../services/budget'
import { sendProblem } from '../utils/problem'
import type { BudgetReport } from '../types/budget'

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
}

/** The handler of the cost meter's route. */
export interface BudgetController {
  measure(ctx: Context): Promise<void>
}

/**
 * `POST /micelio/budget/measure`, for an admin user who may preview the draft: see `docs/api.md`.
 *
 * @remarks
 * It takes the report the admin got from the frontend with the editor's own grant and mints no
 * grant (ADR-0019, amendment of 2026-10-25: only plugin code in the publish path does).
 */
export default ({ strapi }: { strapi: Core.Strapi }): BudgetController => {
  const budget = () => strapi.plugin('micelio').service('budget') as BudgetService

  function refuse(ctx: Context, status: number, code: string, detail: string): void {
    sendProblem(ctx, {
      type: 'about:blank',
      title: TITLES[status] ?? 'Error',
      status,
      detail,
      code,
    })
  }

  return {
    async measure(ctx) {
      const ability = ctx.state.userAbility as UserAbility | undefined
      const adminUser = (ctx.state.user as { id?: number } | undefined)?.id
      if (typeof adminUser !== 'number' || ability?.can(PREVIEW_PERMISSION) !== true) {
        refuse(
          ctx,
          403,
          'previewForbidden',
          `Measuring needs the permission ${PREVIEW_PERMISSION}.`
        )
        return
      }
      const body = readBody(ctx.request.body)
      if (!body) {
        refuse(
          ctx,
          400,
          'budgetRequestInvalid',
          'The body needs uid and documentId as strings, locale as a string or null and the weight report of the frontend'
        )
        return
      }
      if (!budget().applies(body.uid)) {
        refuse(
          ctx,
          400,
          'budgetTypeInvalid',
          `${body.uid} is not a type that is measured against a budget`
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
      if (access.status === 'missing') {
        refuse(ctx, 404, 'editorialEntryNotFound', 'There is no such entry')
        return
      }
      if (access.status !== 'ok') {
        refuse(
          ctx,
          403,
          'previewForbidden',
          'You may not read this entry, so you may not measure it'
        )
        return
      }
      try {
        const { report, ...target } = body
        const data = await budget().standing({ ...target, locale: access.draft.locale }, report)
        ctx.set('Cache-Control', 'private, no-store')
        ctx.body = { data }
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
  }
}

function readBody(
  body: unknown
):
  | { uid: string; documentId: string; locale: string | null | undefined; report: BudgetReport }
  | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { uid, documentId, locale, report: sent } = body as Record<string, unknown>
  if (typeof uid !== 'string' || typeof documentId !== 'string') return undefined
  if (locale !== undefined && locale !== null && typeof locale !== 'string') return undefined
  const report = parseWeightReport(sent)
  return report ? { uid, documentId, locale, report } : undefined
}
