import type { Core } from '@strapi/strapi'
import type { PreviewService } from '../services/preview'

const ADMIN_LOGOUT_HANDLER = 'authentication.logout'

/**
 * Revokes every preview token and grant of an admin user before their logout answers.
 *
 * @remarks
 * Strapi emits `admin.logout` without waiting for its listeners, so a listener can still be
 * revoking when the logout response is sent and a draft request that follows finds the grant. An
 * application middleware, which wraps every request and acts only on the admin's logout route
 * (the route Strapi resolved, not a path, so every spelling the router accepts revokes), awaits
 * `revoke` after the controller has run and before the response leaves, so no grant of the user
 * is served once the logout has answered (ADR-0019, section 3). A failure is logged and does not
 * fail the logout.
 *
 * Losing the right to read a draft revokes its grants when the next exchange or draft request
 * checks the user's abilities again (`stillReadable` in the `preview` service).
 */
export function registerPreviewRevocation(strapi: Core.Strapi): void {
  strapi.server.use(async (ctx, next) => {
    await next()
    const route = (ctx.state as { route?: { handler?: unknown; info?: { pluginName?: unknown } } })
      .route
    if (route?.info?.pluginName !== 'admin' || route.handler !== ADMIN_LOGOUT_HANDLER) return
    const id = (ctx.state as { user?: { id?: unknown } }).user?.id
    if (typeof id !== 'number') return
    try {
      await (strapi.plugin('micelio').service('preview') as PreviewService).revoke(id)
    } catch (error) {
      strapi.log.error(
        `micelio: revoking the preview credentials of an admin user failed: ${String(error)}`
      )
    }
  })
}
