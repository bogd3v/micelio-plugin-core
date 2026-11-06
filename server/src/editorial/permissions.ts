import type { Core } from '@strapi/strapi'

/**
 * Registers the permission of the In review page (issue #57), so a role can be given it in
 * Settings → Roles.
 *
 * @remarks
 * The super admin has it at once. It opens the page and its list (`GET /micelio/review`), which
 * holds only the entries of the types the user may read; approving or sending back is a transition,
 * which the site's policy decides.
 */
export async function registerReviewPermission(strapi: Core.Strapi): Promise<void> {
  await strapi.service('admin::permission').actionProvider.registerMany([
    {
      section: 'plugins',
      displayName: 'Read the In review page',
      uid: 'review.read',
      pluginName: 'micelio',
    },
  ])
}
