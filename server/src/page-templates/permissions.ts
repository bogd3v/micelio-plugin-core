import type { Core } from '@strapi/strapi'

/**
 * Registers the permission to manage page templates, so a role can be given it in Settings → Roles.
 *
 * @remarks
 * The super admin has it at once. It lets a role save a page as a template, export and import
 * templates: what every editor of the site may start a page from, so it is a grant of its own.
 */
export async function registerTemplatesPermission(strapi: Core.Strapi): Promise<void> {
  await strapi.service('admin::permission').actionProvider.registerMany([
    {
      section: 'plugins',
      displayName: 'Manage the page templates of a site',
      uid: 'templates.manage',
      pluginName: 'micelio',
    },
  ])
}
