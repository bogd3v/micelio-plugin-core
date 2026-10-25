import type { Core } from '@strapi/strapi'
import type { ExtensionRegistry } from './registry'

export { createExtensionRegistry, type ExtensionRegistry } from './registry'
export { missingLocales } from './validate'

/** The extension registry of a Strapi instance with this plugin. */
export function extensionsOf(strapi: Core.Strapi): ExtensionRegistry {
  return strapi.plugin('micelio').service('extensions') as ExtensionRegistry
}
