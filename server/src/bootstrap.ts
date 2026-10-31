import type { Core } from '@strapi/strapi'
import { ensureSiteSections } from './extensions/site-sections'
import { registerStatusRefresh } from './status/refresh'
import { registerScheduler } from './editorial/scheduler'
import { syncBlockCatalogue } from './migrations/block-catalogue'
import { ensureDefaultSite } from './migrations/default-site'
import { backfillSite } from './migrations/site-backfill'
import { registerPreviewPermission } from './preview/permissions'
import { registerPreviewRevocation } from './preview/revocation'
import { registerStatusPermission } from './status/permissions'
import { registerTransferPermissions } from './transfers/permissions'

/** The first look at the frontends and the release feed; a failure is logged, never a failed boot. */
async function refreshAbout(strapi: Core.Strapi): Promise<void> {
  try {
    await strapi.plugin('micelio').service('about').refresh()
  } catch (error) {
    strapi.log.warn(`[micelio] the first check of the frontends failed: ${String(error)}`)
  }
}

/** Bootstrap phase: runs once the database and the other plugins are ready. */
const bootstrap = async ({ strapi }: { strapi: Core.Strapi }): Promise<void> => {
  await ensureDefaultSite(strapi)
  const backfilled = await backfillSite(strapi)
  if (backfilled > 0)
    strapi.log.info(`[micelio] gave the default site to ${backfilled} categories and tags`)
  await ensureSiteSections(strapi)
  // After the default site: the check reads the sites' origins.
  await strapi.plugin('micelio').service('hostCheck').enforce()
  registerScheduler(strapi)
  registerStatusRefresh(strapi)
  // In the background: the boot does not wait for a frontend or a feed.
  void refreshAbout(strapi)
  await registerStatusPermission(strapi)
  await registerPreviewPermission(strapi)
  await registerTransferPermissions(strapi)
  await strapi.plugin('micelio').service('transfers').failInterrupted()
  registerPreviewRevocation(strapi)
  // Last: a boot the host check refuses announces no change.
  await syncBlockCatalogue(strapi)
}

export default bootstrap
