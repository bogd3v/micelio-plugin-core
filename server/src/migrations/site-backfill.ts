import type { Core } from '@strapi/strapi'

// Self-contained on purpose (standard, section 6): it keeps its own constants, so it keeps working
// after the rest of the plugin changes.
const SITE_UID = 'plugin::micelio.site'
const SITE_ATTRIBUTE = 'site'
const BACKFILLED = ['plugin::micelio.category', 'plugin::micelio.tag']

/**
 * Gives every category and tag with no site the default site.
 *
 * @remarks
 * The rows `micelio-cms` 0.5 wrote have no `site`, because that version had no sites. Every locale
 * of an entry is a row of its own, and each one is linked. Idempotent: a row that has a site is
 * never touched, so a second run changes nothing, and a site the admin panel chose is kept. Run it
 * after the default site exists; without a default site there is nothing to give.
 *
 * @returns How many rows got the default site.
 */
export async function backfillSite(strapi: Core.Strapi): Promise<number> {
  const site = (await strapi.db.query(SITE_UID).findOne({
    where: { isDefault: true },
    select: ['id'],
  })) as { id: number } | null
  if (!site) return 0

  let linked = 0
  for (const uid of BACKFILLED) {
    const rows = (await strapi.db.query(uid).findMany({
      where: { [SITE_ATTRIBUTE]: null },
      select: ['id'],
    })) as { id: number }[]
    for (const row of rows) {
      await strapi.db
        .query(uid)
        .update({ where: { id: row.id }, data: { [SITE_ATTRIBUTE]: site.id } })
    }
    linked += rows.length
  }
  return linked
}
