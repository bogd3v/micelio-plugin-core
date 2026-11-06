import type { Core, UID } from '@strapi/strapi'
import { REDIRECT_UID, SLUG_CHANGE_RULE } from '../constants/page-settings'
import { pathOfSlug, planRedirects, type RedirectRow } from './redirects'

/** The page whose published slug changes. */
export interface SlugChange {
  /** The `documentId` of the page's site. */
  site: string
  locale: string | null
  /** The slug that is live now. */
  from: string
  /** The slug the publish makes live. */
  to: string
}

/**
 * Writes the redirects a change of a published slug needs: the old address to the new one, and
 * the ones that pointed to the old address to the new one too.
 *
 * @remarks
 * It writes through the document service, in the transaction of the caller, so the redirect and
 * the publish stand or fall together (`performTransition`). A page that goes back to an address
 * it left loses the redirect from it.
 */
export async function recordSlugChange(strapi: Core.Strapi, change: SlugChange): Promise<void> {
  const from = pathOfSlug(change.from)
  const to = pathOfSlug(change.to)
  const redirects = strapi.documents(REDIRECT_UID as UID.ContentType)
  const existing = (await redirects.findMany({
    filters: {
      $and: [
        { site: { documentId: change.site } },
        change.locale === null
          ? { entryLocale: { $null: true } }
          : { entryLocale: { $eq: change.locale } },
        { $or: [{ from: { $in: [from, to] } }, { to: { $in: [from, to] } }] },
      ],
    },
    fields: ['documentId', 'from', 'to'],
    limit: 100,
  } as never)) as unknown as RedirectRow[]
  const plan = planRedirects({ from, to }, existing)
  for (const documentId of plan.remove) await redirects.delete({ documentId })
  for (const documentId of plan.retarget) {
    await redirects.update({ documentId, data: { to } as never })
  }
  if (plan.create) {
    await redirects.create({
      data: {
        ...plan.create,
        entryLocale: change.locale,
        rule: SLUG_CHANGE_RULE,
        site: change.site,
      } as never,
    })
  }
}
