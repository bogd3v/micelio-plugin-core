import type { Core } from '@strapi/strapi'
import type { Context } from 'koa'
import { STATUS_READ_PERMISSION } from '../constants/status'
import { sendProblem } from '../utils/problem'

interface UserAbility {
  /** A plugin permission has no subject, so `can` takes the action alone. */
  can(action: string): boolean
}

/** `GET /micelio/status`, for an admin user with the status permission: see `docs/api.md`. */
export default ({ strapi }: { strapi: Core.Strapi }): { find(ctx: Context): Promise<void> } => ({
  async find(ctx) {
    const ability = ctx.state.userAbility as UserAbility | undefined
    if (ability?.can(STATUS_READ_PERMISSION) !== true) {
      sendProblem(ctx, {
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: `Reading the status page needs the permission ${STATUS_READ_PERMISSION}.`,
        code: 'statusForbidden',
      })
      return
    }
    ctx.body = { data: await strapi.plugin('micelio').service('status').read() }
  },
})
