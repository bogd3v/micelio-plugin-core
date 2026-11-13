import type { Core } from '@strapi/strapi'

/**
 * Registers the custom field `micelio.icon` (`plugin::micelio.icon`): a string that holds a name
 * of the icon catalogue, stored as the editor picked it. The admin registers the picker for it; the
 * check that the value is a name is {@link iconDocuments} (`./documents`).
 */
export function registerIconField(strapi: Core.Strapi): void {
  strapi.customFields.register({ name: 'icon', plugin: 'micelio', type: 'string' })
}
