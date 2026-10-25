import type { Core } from '@strapi/strapi'
import type { PreviewService } from '../services/preview'

/**
 * Revokes every preview token and grant of an admin user when they log out of the admin.
 *
 * @remarks
 * Losing the right to read a draft revokes its grants when the next exchange or draft request
 * checks the user's abilities again (`stillReadable` in the `preview` service).
 */
export function registerPreviewRevocation(strapi: Core.Strapi): void {
  strapi.eventHub.on('admin.logout', async (event: { user?: { id?: number } }) => {
    const id = event.user?.id
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
