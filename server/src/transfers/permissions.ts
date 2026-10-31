import type { Core } from '@strapi/strapi'

/**
 * Registers the permissions of the Export and import page, so a role can be given them in
 * Settings → Roles.
 *
 * @remarks
 * The super admin has them at once. The second lets an export hold personal data and is logged.
 */
export async function registerTransferPermissions(strapi: Core.Strapi): Promise<void> {
  await strapi.service('admin::permission').actionProvider.registerMany([
    {
      section: 'plugins',
      displayName: 'Export and import sites',
      uid: 'transfer',
      pluginName: 'micelio',
    },
    {
      section: 'plugins',
      displayName: 'Include personal data in an export',
      uid: 'transfer.personal',
      pluginName: 'micelio',
    },
  ])
}
