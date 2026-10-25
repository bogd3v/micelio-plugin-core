import type { Core } from '@strapi/strapi'
import type { Context } from 'koa'
import { STATUS_READ_PERMISSION } from '../constants/status'
import { extensionsOf } from '../extensions'
import type { StatusReport } from '../types/status'
import { sendProblem } from '../utils/problem'

interface UserAbility {
  /** A plugin permission has no subject, so `can` takes the action alone. */
  can(action: string): boolean
}

type Handler = (ctx: Context) => Promise<void>

/**
 * `GET /micelio/status` and `POST /micelio/status/host-check`, for an admin user with the status
 * permission: see `docs/api.md`.
 */
export default ({ strapi }: { strapi: Core.Strapi }): Record<'find' | 'runHostCheck', Handler> => {
  const status = () => strapi.plugin('micelio').service('status')

  return {
    async find(ctx) {
      if (!isAllowed(ctx)) return
      const report = await status().read()
      ctx.body = { data: { ...report, plugins: visiblePlugins(strapi, ctx, report.plugins) } }
    },
    async runHostCheck(ctx) {
      if (!isAllowed(ctx)) return
      ctx.body = { data: await status().runHostCheck() }
    },
  }
}

/** Whether the admin may read the status page; answers the `403` itself when not. */
function isAllowed(ctx: Context): boolean {
  const ability = ctx.state.userAbility as UserAbility | undefined
  if (ability?.can(STATUS_READ_PERMISSION) === true) return true
  sendProblem(ctx, {
    type: 'about:blank',
    title: 'Forbidden',
    status: 403,
    detail: `Reading the status page needs the permission ${STATUS_READ_PERMISSION}.`,
    code: 'statusForbidden',
  })
  return false
}

/** The plugins' checks of the registrations whose permission the caller has. */
function visiblePlugins(
  strapi: Core.Strapi,
  ctx: Context,
  plugins: StatusReport['plugins']
): StatusReport['plugins'] {
  const ability = ctx.state.userAbility as UserAbility | undefined
  const allowed = new Set(
    extensionsOf(strapi)
      .statusChecks()
      .filter(({ permission }) => ability?.can(permission) === true)
      .map(({ id }) => id)
  )
  return Object.fromEntries(Object.entries(plugins).filter(([id]) => allowed.has(id)))
}
