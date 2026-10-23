import type { Core } from '@strapi/strapi'

/**
 * Registers the permission of the status page, so a role can be given it in Settings → Roles.
 *
 * @remarks
 * The super admin has it at once. The page reads the host's configuration (database client,
 * middlewares, frontends), which an author or an editor does not need.
 */
export async function registerStatusPermission(strapi: Core.Strapi): Promise<void> {
  await strapi.service('admin::permission').actionProvider.registerMany([
    {
      section: 'plugins',
      displayName: 'Read the Micelio status page',
      uid: 'status.read',
      pluginName: 'micelio',
    },
  ])
}
