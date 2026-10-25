import type { Core } from '@strapi/strapi'
import { ensureSiteSections } from './extensions/site-sections'
import { registerStatusRefresh } from './status/refresh'
import { registerScheduler } from './editorial/scheduler'
import { syncBlockCatalogue } from './migrations/block-catalogue'
import { ensureDefaultSite } from './migrations/default-site'
import { registerPreviewPermission } from './preview/permissions'
import { registerPreviewRevocation } from './preview/revocation'
import { registerStatusPermission } from './status/permissions'

/** Bootstrap phase: runs once the database and the other plugins are ready. */
const bootstrap = async ({ strapi }: { strapi: Core.Strapi }): Promise<void> => {
  await ensureDefaultSite(strapi)
  await ensureSiteSections(strapi)
  // After the default site: the check reads the sites' origins.
  await strapi.plugin('micelio').service('hostCheck').enforce()
  registerScheduler(strapi)
  registerStatusRefresh(strapi)
  await registerStatusPermission(strapi)
  await registerPreviewPermission(strapi)
  registerPreviewRevocation(strapi)
  // Last: a boot the host check refuses announces no change.
  await syncBlockCatalogue(strapi)
}

export default bootstrap
