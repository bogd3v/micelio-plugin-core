import type { Core } from '@strapi/strapi'
import { registerScheduler } from './editorial/scheduler'
import { ensureDefaultSite } from './migrations/default-site'

/** Bootstrap phase: runs once the database and the other plugins are ready. */
const bootstrap = async ({ strapi }: { strapi: Core.Strapi }): Promise<void> => {
  await ensureDefaultSite(strapi)
  registerScheduler(strapi)
}

export default bootstrap
