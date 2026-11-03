import type { Core } from '@strapi/strapi'

/**
 * Registers the permissions of the Block catalogue page, so a role can be given them in
 * Settings → Roles.
 *
 * @remarks
 * The super admin has them at once. `blocks.read` opens the page; `blocks.manage` lets a role
 * enable, disable and configure a block for a site, which changes what every editor of the site
 * may insert, so it is a separate, narrower grant.
 */
export async function registerBlocksPermissions(strapi: Core.Strapi): Promise<void> {
  await strapi.service('admin::permission').actionProvider.registerMany([
    {
      section: 'plugins',
      displayName: 'Read the block catalogue of a site',
      uid: 'blocks.read',
      pluginName: 'micelio',
    },
    {
      section: 'plugins',
      displayName: 'Manage the block catalogue of a site',
      uid: 'blocks.manage',
      pluginName: 'micelio',
    },
  ])
}
