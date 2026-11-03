import type { Core, UID } from '@strapi/strapi'
import type { PluginConfig } from '../config'
import { pageTypeOf } from '../budget/rules'
import { BLOCK_SETTING_UID } from '../constants/blocks'
import { BlockNotAllowedError } from './error'
import type { BlockNotAllowedViolation } from './error'
import { populateOf } from './populate'
import { blockIdsIn, findBlockNotAllowed, settingOf } from './rules'

/** A write whose blocks {@link assertBlocksAllowed} checks. */
export interface BlockWrite {
  uid: UID.ContentType
  /**
   * `update` compares with the stored draft; `create` starts from nothing; `clone` checks the
   * source's draft with `data` laid over it.
   */
  action: 'create' | 'update' | 'clone'
  /** An `update` that moves the document to `site`: the whole page counts as added there. */
  movesSite?: boolean
  /** The site the document belongs to after the write. */
  site: { documentId: string; slug: string }
  documentId?: string
  locale?: string
  data: Record<string, unknown>
}

/**
 * Finds the first block a write adds that its site disabled or does not allow on the page's type.
 *
 * @remarks
 * The one check behind the document service middleware and the dry run of an import, so that an
 * archive is refused before anything is written. `null` when the data names no block, the site
 * has no setting, or the write adds nothing the site refuses. See `findBlockNotAllowed` for what
 * counts as an addition.
 */
export async function findBlockNotAllowedIn(
  strapi: Core.Strapi,
  write: BlockWrite
): Promise<BlockNotAllowedViolation | null> {
  const model = strapi.contentType(write.uid)
  const componentAttributes = (uid: string) =>
    strapi.components[uid as UID.Component]?.attributes as Record<string, unknown> | undefined
  const documents = strapi.documents(write.uid)
  const populate = populateOf(model.attributes, componentAttributes)
  const readDrafts = async (locale: string | undefined) =>
    (await documents.findMany({
      filters: { documentId: write.documentId },
      locale: locale ?? '*',
      status: 'draft',
      populate,
    } as never)) as unknown as Record<string, unknown>[]

  // The pages the write leaves behind: each with the blocks it already holds (what an update
  // compares with) and the data checked against the site.
  let pages: { data: Record<string, unknown>; stored: Record<string, unknown> | null }[] = [
    { data: write.data, stored: null },
  ]
  if (write.documentId && write.action === 'clone') {
    // A duplicate carries every attribute of its source that `data` does not replace.
    pages = (await readDrafts(write.locale)).map((source) => ({
      data: { ...source, ...write.data },
      stored: null,
    }))
  } else if (write.documentId && write.action === 'update') {
    const stored = (await documents.findOne({
      documentId: write.documentId,
      locale: write.locale,
      status: 'draft',
      populate,
    } as never)) as Record<string, unknown> | null
    // A page moved to another site is new there: all of its blocks count as added.
    pages = [
      write.movesSite
        ? { data: { ...stored, ...write.data }, stored: null }
        : { data: write.data, stored },
    ]
  }
  const sentOf = (data: Record<string, unknown>) =>
    blockIdsIn(model.attributes, data, componentAttributes)
  if (pages.every((page) => sentOf(page.data).length === 0)) return null
  const rows = (await strapi.db.query(BLOCK_SETTING_UID as UID.ContentType).findMany({
    where: { site: { documentId: write.site.documentId } },
  })) as Record<string, unknown>[]
  if (rows.length === 0) return null
  const settings = new Map(
    rows.map((row) => [String(row.block), settingOf(String(row.block), row)] as const)
  )
  const budgets = strapi.config.get<PluginConfig['budgets']>('plugin::micelio.budgets')
  for (const page of pages) {
    const pageType = pageTypeOf(
      { pageType: page.data.pageType ?? page.stored?.pageType },
      budgets,
      write.site.slug
    )
    const violation = findBlockNotAllowed(
      sentOf(page.data),
      page.stored ? sentOf(page.stored) : [],
      settings,
      pageType
    )
    if (violation) return violation
  }
  return null
}

/** Throws {@link BlockNotAllowedError} for the first block a write adds that its site refuses. */
export async function assertBlocksAllowed(strapi: Core.Strapi, write: BlockWrite): Promise<void> {
  const violation = await findBlockNotAllowedIn(strapi, write)
  if (violation) throw new BlockNotAllowedError(violation)
}
