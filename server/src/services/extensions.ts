import type { Core } from '@strapi/strapi'
import { createExtensionRegistry, type ExtensionRegistry } from '../extensions'

// The `extensions` service: the registry of this Strapi instance. As with `hooks`, Strapi creates
// a service the first time it is asked for, so it exists before any plugin's `register` runs.
export default ({ strapi }: { strapi: Core.Strapi }): ExtensionRegistry =>
  createExtensionRegistry(strapi)
