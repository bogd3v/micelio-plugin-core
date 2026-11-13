import type { Core, UID } from '@strapi/strapi'
import type { PluginConfig } from '../config'
import { pageTypeOf } from '../budget/rules'
import { BLOCKS } from '../../../contract/blocks'
import { BLOCK_SETTING_UID } from '../constants/blocks'
import { SITE_UID } from '../constants/site'
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
  /**
   * The `modules` the site will have when they are not stored yet (the dry run of an import that
   * creates the site or rewrites its settings): read from here instead of the database.
   */
  modules?: unknown
}

/** The `modules` component of a site as stored; `undefined` when the site has none. */
export async function modulesOf(strapi: Core.Strapi, siteDocumentId: string): Promise<unknown> {
  const site = (await strapi.db.query(SITE_UID as UID.ContentType).findOne({
    where: { documentId: siteDocumentId },
    populate: { modules: true },
  })) as { modules?: unknown } | null
  return site?.modules
}

/**
 * Finds the first block a write adds that its site disabled, does not allow on the page's type, or
 * has the module off for.
 *
 * @remarks
 * The one check behind the document service middleware and the dry run of an import, so that an
 * archive is refused before anything is written. `null` when the data names no block, the site
 * has no setting and no block of the write needs a module the site has off, or the write adds
 * nothing the site refuses. See `findBlockNotAllowed` for what
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
  // The site's modules are read only when a block of the write needs one.
  const needsModule = pages.some((page) =>
    sentOf(page.data).some((id) => BLOCKS.find((block) => block.id === id)?.module)
  )
  if (rows.length === 0 && !needsModule) return null
  const modules = needsModule
    ? (write.modules ?? (await modulesOf(strapi, write.site.documentId)))
    : undefined
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
      pageType,
      modules
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
