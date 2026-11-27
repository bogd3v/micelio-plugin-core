import type { Core } from '@strapi/strapi'

/**
 * Registers the permission of the Themes page (issue #59), so a role can be given it in
 * Settings → Roles.
 *
 * @remarks
 * Strapi gives a new plugin permission to the super admin only, which keeps ADR-0009 of `micelio`,
 * section 3: only the Super Admin changes the theme. A role given it may change the theme pin of
 * every site, and so what the frontend installs (`docs/operate/themes-page.md`).
 */
export async function registerThemesPermission(strapi: Core.Strapi): Promise<void> {
  await strapi.service('admin::permission').actionProvider.registerMany([
    {
      section: 'plugins',
      displayName: 'Change the theme of a site',
      uid: 'themes.manage',
      pluginName: 'micelio',
    },
  ])
}
