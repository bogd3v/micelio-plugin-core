import type { Core } from '@strapi/strapi'

/**
 * Registers the permission to ask for a preview URL, so a role can be given it in Settings → Roles.
 *
 * @remarks
 * The super admin has it at once. The route also needs the permission to read the document, so a
 * role previews only what it may read.
 */
export async function registerPreviewPermission(strapi: Core.Strapi): Promise<void> {
  await strapi.service('admin::permission').actionProvider.registerMany([
    {
      section: 'plugins',
      displayName: 'Preview drafts on the frontend',
      uid: 'preview',
      pluginName: 'micelio',
    },
  ])
}
