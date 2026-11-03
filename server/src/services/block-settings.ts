import type { Core, UID } from '@strapi/strapi'
import { BLOCKS, type Block } from '../../../contract/blocks'
import { blockJsonSchema } from '../../../contract/strapi'
import { BlockSettingError } from '../block-settings/error'
import { populateOf } from '../block-settings/populate'
import {
  allowedPageTypesOf,
  blockIdsIn,
  knownPageTypes,
  mergedOptions,
  settingOf,
} from '../block-settings/rules'
import type { PluginConfig } from '../config'
import { BLOCK_SETTING_UID } from '../constants/blocks'
import { SITE_UID } from '../constants/site'
import { readSites } from '../status/read'
import { isSiteScoped, SITE_ATTRIBUTE } from '../site-scope'
import type { BudgetService } from './budget'
import type { BlockSetting, BlockUsage } from '../types/blocks'

/** The site a settings route works on. */
export interface BlockSite {
  documentId: string
  slug: string
}

/** What a write to a block's settings may name; a field it leaves out stays as it is. */
export interface BlockSettingInput {
  enabled?: boolean
  allowedPageTypes?: string[] | null
  defaultOptions?: Record<string, unknown> | null
  labels?: Record<string, unknown> | null
}

/**
 * Tells whether the caller may read a page, or one `field` of it, given its type and the draft row
 * (`createdBy` populated).
 */
export type PageReader = (uid: string, row: Record<string, unknown>, field?: string) => boolean

/** The `blockSettings` service: `strapi.plugin('micelio').service('blockSettings')`. */
export interface BlockSettingsService {
  /** The site with this `slug`, or `null` when there is none. */
  siteOf(slug: string): Promise<BlockSite | null>

  /** Every site, for the page's site select. */
  sites(): Promise<{ slug: string; name: string; isDefault: boolean }[]>

  /**
   * The catalogue as one site sees it, for `GET /micelio/blocks?site=`: the blocks it has not
   * disabled, each with the options a new block starts with and the page types it is allowed in.
   */
  merged(site: BlockSite): Promise<Record<string, unknown>[]>

  /**
   * What the Block catalogue page shows for a site: every block, disabled ones included, with its
   * setting, the core's defaults and the number of pages that hold it.
   */
  view(site: BlockSite): Promise<Record<string, unknown>>

  /**
   * Stores what a site manages of a block, creating the row on the first write.
   *
   * @throws `BlockOptionError` for a default outside the block's values, and `BlockSettingError` for
   * an unknown block, a page type or a label that names nothing.
   */
  save(site: BlockSite, blockId: string, input: BlockSettingInput): Promise<BlockSetting>

  /** Deletes a site's setting of a block, so it takes the core's defaults again. */
  reset(site: BlockSite, blockId: string): Promise<void>

  /**
   * The pages of the site that hold a block, by type, with the state of each.
   *
   * @param canRead - Drops the pages the caller may not read; every page when absent.
   */
  usage(site: BlockSite, blockId: string, canRead?: PageReader): Promise<BlockUsage[]>
}

const BATCH = 100
const BYTES_PER_KB = 1024

export default ({ strapi }: { strapi: Core.Strapi }): BlockSettingsService => {
  const query = () => strapi.db.query(BLOCK_SETTING_UID as UID.ContentType)
  const budgets = () => strapi.config.get<PluginConfig['budgets']>('plugin::micelio.budgets')
  const pageTypesOf = (site: BlockSite) => knownPageTypes(budgets(), site.slug)

  async function rowsOf(site: BlockSite): Promise<Map<string, Record<string, unknown>>> {
    const rows = (await query().findMany({
      where: { site: { documentId: site.documentId } },
    })) as Record<string, unknown>[]
    return new Map(rows.map((row) => [String(row.block), row]))
  }

  function blockOf(blockId: string): Block {
    const block = BLOCKS.find((candidate) => candidate.id === blockId)
    if (!block) throw new BlockSettingError('block', `The catalogue has no block "${blockId}"`)
    return block
  }

  // The pages of a site that hold a block, one pass over its types that have blocks in them.
  async function scan(
    site: BlockSite,
    onPage: (page: BlockUsage, blocks: string[]) => void,
    canRead?: PageReader
  ): Promise<void> {
    const componentAttributes = (uid: string) =>
      strapi.components[uid as UID.Component]?.attributes as Record<string, unknown> | undefined
    const budget = strapi.plugin('micelio').service('budget') as BudgetService
    for (const model of Object.values(strapi.contentTypes)) {
      if (!isSiteScoped(model)) continue
      const holdsComponents = Object.values(
        model.attributes as Record<string, { type?: string }>
      ).some((attribute) => attribute.type === 'dynamiczone' || attribute.type === 'component')
      if (!holdsComponents) continue
      const documents = strapi.documents(model.uid as UID.ContentType)
      const populate = {
        ...populateOf(model.attributes, componentAttributes),
        ...(model.attributes.createdBy ? { createdBy: true } : {}),
      }
      const hasDrafts = model.options?.draftAndPublish === true
      const filters = { [SITE_ATTRIBUTE]: { documentId: { $eq: site.documentId } } }
      const published = new Set<string>()
      if (hasDrafts) {
        for (let start = 0; ; start += BATCH) {
          const rows = (await documents.findMany({
            filters,
            locale: '*',
            status: 'published',
            fields: ['documentId', 'locale'],
            sort: 'id',
            limit: BATCH,
            start,
          } as never)) as unknown as { documentId: string; locale?: string | null }[]
          for (const row of rows) published.add(`${row.documentId}:${row.locale ?? ''}`)
          if (rows.length < BATCH) break
        }
      }
      for (let start = 0; ; start += BATCH) {
        const rows = (await documents.findMany({
          filters,
          locale: '*',
          status: 'draft',
          populate,
          sort: 'id',
          limit: BATCH,
          start,
        } as never)) as unknown as Record<string, unknown>[]
        for (const row of rows) {
          const blocks = blockIdsIn(model.attributes, row, componentAttributes)
          if (blocks.length === 0) continue
          if (canRead && !canRead(model.uid, row)) continue
          const documentId = String(row.documentId)
          const locale = typeof row.locale === 'string' ? row.locale : null
          // The title is the first of these fields the caller may read; none: the document id.
          const title = (['title', 'name', 'slug'] as const)
            .filter((field) => !canRead || canRead(model.uid, row, field))
            .map((field) => row[field])
            .find((value): value is string => typeof value === 'string' && value !== '')
          onPage(
            {
              uid: model.uid,
              documentId,
              locale,
              title: title ?? documentId,
              state:
                !hasDrafts || published.has(`${documentId}:${locale ?? ''}`)
                  ? 'published'
                  : 'draft',
              updatedAt:
                row.updatedAt == null ? null : new Date(String(row.updatedAt)).toISOString(),
              isMeasured: budget.applies(model.uid),
            },
            blocks
          )
        }
        if (rows.length < BATCH) break
      }
    }
  }

  return {
    async siteOf(slug) {
      const row = (await strapi.db
        .query(SITE_UID as UID.ContentType)
        .findOne({ where: { slug }, select: ['documentId', 'slug'] })) as BlockSite | null
      return row ? { documentId: row.documentId, slug: row.slug } : null
    },

    async sites() {
      const sites = await readSites(strapi)
      return sites.map(({ slug, name, isDefault }) => ({ slug, name, isDefault }))
    },

    async merged(site) {
      const rows = await rowsOf(site)
      const pageTypes = pageTypesOf(site)
      return BLOCKS.flatMap((block) => {
        const setting = settingOf(block.id, rows.get(block.id))
        if (!setting.enabled) return []
        const { schema, ...rest } = block
        return [
          {
            ...rest,
            component: schema.component,
            schema: blockJsonSchema(block),
            options: mergedOptions(block, setting),
            label: setting.labels,
            pageTypes: allowedPageTypesOf(setting, pageTypes),
          },
        ]
      })
    },

    async view(site) {
      const rows = await rowsOf(site)
      const pageTypes = pageTypesOf(site)
      const used = new Map<string, Set<string>>()
      await scan(site, (page, blocks) => {
        for (const id of blocks) {
          used.set(id, (used.get(id) ?? new Set()).add(`${page.uid}:${page.documentId}`))
        }
      })
      return {
        site: site.slug,
        pageTypes,
        blocks: BLOCKS.map((block) => {
          const setting = settingOf(block.id, rows.get(block.id))
          return {
            id: block.id,
            group: block.group,
            component: block.schema.component,
            options: mergedOptions(block, setting),
            costKb: Math.round(((block.cost.css + block.cost.js) / BYTES_PER_KB) * 10) / 10,
            isIsland: block.cost.island !== null,
            enabled: setting.enabled,
            allowedPageTypes: setting.allowedPageTypes,
            defaultOptions: setting.defaultOptions,
            labels: setting.labels,
            used: used.get(block.id)?.size ?? 0,
          }
        }),
      }
    },

    async save(site, blockId, input) {
      blockOf(blockId)
      const data: Record<string, unknown> = {}
      if (input.enabled !== undefined) data.enabled = input.enabled
      if (input.allowedPageTypes !== undefined) data.allowedPageTypes = input.allowedPageTypes
      if (input.defaultOptions !== undefined) {
        data.defaultOptions =
          input.defaultOptions === null
            ? null
            : Object.fromEntries(
                Object.entries(input.defaultOptions).map(([name, value]) => [
                  name,
                  typeof value === 'number' ? String(value) : value,
                ])
              )
      }
      if (input.labels !== undefined) {
        data.labels =
          input.labels === null
            ? null
            : Object.fromEntries(
                Object.entries(input.labels).flatMap(([locale, text]) =>
                  typeof text === 'string' && text.trim() === '' ? [] : [[locale, text]]
                )
              )
      }
      const documents = strapi.documents(BLOCK_SETTING_UID as UID.ContentType)
      const existing = (await rowsOf(site)).get(blockId)
      const saved = (await (existing
        ? documents.update({ documentId: String(existing.documentId), data } as never)
        : documents.create({
            data: { ...data, block: blockId, [SITE_ATTRIBUTE]: site.documentId },
          } as never))) as unknown as Record<string, unknown>
      return settingOf(blockId, saved)
    },

    async reset(site, blockId) {
      blockOf(blockId)
      const existing = (await rowsOf(site)).get(blockId)
      if (!existing) return
      await strapi
        .documents(BLOCK_SETTING_UID as UID.ContentType)
        .delete({ documentId: String(existing.documentId) })
    },

    async usage(site, blockId, canRead) {
      blockOf(blockId)
      const pages: BlockUsage[] = []
      await scan(
        site,
        (page, blocks) => {
          if (blocks.includes(blockId)) pages.push(page)
        },
        canRead
      )
      return pages.sort((a, b) => a.title.localeCompare(b.title) || a.uid.localeCompare(b.uid))
    },
  }
}
