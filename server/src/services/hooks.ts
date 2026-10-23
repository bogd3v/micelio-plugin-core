import type { Core } from '@strapi/strapi'
import { createHookRegistry, type HookRegistry } from '../hooks'

// The `hooks` service: the registry of this Strapi instance. Strapi creates a service the first
// time it is asked for, so it exists before any plugin's `register` runs (docs/hooks.md).
export default ({ strapi }: { strapi: Core.Strapi }): HookRegistry => createHookRegistry(strapi.log)
