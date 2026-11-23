import type { Core } from '@strapi/strapi'
import { REUSABLE_BLOCK_UID } from '../constants/reusable-blocks'
import { pagesUsing, referenceFields } from '../reusable-blocks'
import type { ReferencingPage } from '../reusable-blocks/error'
import type { ReferenceField } from '../reusable-blocks/rules'
import type { EntryPayload } from '../types/hooks'

/**
 * The `reusableBlocks` service: `strapi.plugin('micelio').service('reusableBlocks')`.
 *
 * @remarks
 * A reusable block (`plugin::micelio.reusable-block`, ADR-0022 section 1) is one block that many
 * pages of its site reference. Publishing, republishing or unpublishing it fires `afterPublish` or
 * `afterUnpublish` for the reusable block only: the pages are not edited and fire nothing. A
 * static build that rebuilds pages asks `usedOn` which ones show it (`docs/api.md`).
 */
export interface ReusableBlocksService {
  /** Where the site-scoped types reference reusable blocks, read from their schemas. */
  referenceFields(): ReferenceField[]
  /**
   * The pages of the reusable block's site that reference it, in any locale, draft or published,
   * one per page and locale; with `locale`, only those that reference that locale of the block.
   */
  usedOn(target: { documentId: string; locale?: string }): Promise<ReferencingPage[]>
  /**
   * The handler of `afterPublish` and `afterUnpublish`: for a reusable block, lists the pages that
   * show it, in any locale, and logs them; for any other type, nothing. It writes nothing and fires
   * no hook, so a second run for the same `documentId` and locale changes nothing.
   *
   * @returns The pages, empty for another type.
   */
  republish(payload: Readonly<EntryPayload>): Promise<ReferencingPage[]>
}

export default ({ strapi }: { strapi: Core.Strapi }): ReusableBlocksService => ({
  referenceFields() {
    return referenceFields(strapi)
  },
  usedOn(target) {
    return pagesUsing(strapi, target)
  },
  async republish(payload) {
    if (payload.type !== REUSABLE_BLOCK_UID) return []
    const pages = await pagesUsing(strapi, { documentId: payload.documentId })
    if (pages.length > 0) {
      const list = pages.map((page) => `${page.uid} ${page.documentId} (${page.locale ?? '-'})`)
      strapi.log.info(
        `[micelio] reusable block ${payload.documentId} (${payload.locale ?? '-'}) changed on ` +
          `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}: ${list.join(', ')}`
      )
    }
    return pages
  },
})
