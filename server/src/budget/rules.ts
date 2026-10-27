import { z } from 'zod'
import {
  DEFAULT_MEASURED_TYPES,
  DEFAULT_PAGE_TYPE,
  DEFAULT_PAGE_TYPE_BUDGETS_KB,
} from '../constants/budget'
import type { BudgetsConfig } from '../config'
import type { BudgetBlock, BudgetReport } from '../types/budget'

const kb = z.number().finite().nonnegative()

// What the frontend's weight route answers (`GET /api/preview/<uid>/<documentId>/weight`): any
// other shape is a frontend this plugin cannot read, which refuses the publish.
const reportSchema = z.object({
  data: z.object({
    mode: z.literal('dynamic'),
    htmlKb: kb,
    cssKb: kb,
    jsKb: kb,
    fontKb: kb,
    imagesKb: kb,
    totalKb: kb,
    onDemandKb: kb,
    blocks: z.array(z.object({ id: z.string().min(1), kb, onDemandKb: kb })),
  }),
})

/** Reads the body of the weight route; `null` when it is not a report of the dynamic mode. */
export function parseWeightReport(body: unknown): BudgetReport | null {
  const parsed = reportSchema.safeParse(body)
  if (!parsed.success) return null
  const { totalKb, onDemandKb, htmlKb, cssKb, jsKb, fontKb, imagesKb, blocks } = parsed.data.data
  const blocksKb = Math.round(blocks.reduce((sum, block) => sum + block.kb, 0) * 10) / 10
  return {
    totalKb,
    blocksKb,
    frameworkKb: Math.round((totalKb - blocksKb) * 10) / 10,
    onDemandKb,
    htmlKb,
    cssKb,
    jsKb,
    fontKb,
    imagesKb,
    blocks: blocks.map((block, index) => ({ position: index + 1, ...block })),
  }
}

/**
 * The page type of a draft: its `pageType` when the budgets list it, else `standard`.
 *
 * @remarks
 * The page type becomes an attribute of its own with the page settings (bogd3v/micelio-plugin-core#52).
 * Until then a type that has a string `pageType` uses it, and every other draft is `standard`.
 */
export function pageTypeOf(
  draft: { pageType?: unknown },
  budgets: BudgetsConfig,
  siteSlug: string | null
): string {
  const { pageType } = draft
  if (typeof pageType !== 'string') return DEFAULT_PAGE_TYPE
  const known =
    budgets.pageTypes[pageType] !== undefined ||
    Boolean(siteSlug && budgets.sites[siteSlug]?.[pageType] !== undefined)
  return known ? pageType : DEFAULT_PAGE_TYPE
}

/** The budget of a page type for a site, in kB: the site's own, else the page type's, else the same for `standard`, else the core's default. */
export function budgetKbOf(
  budgets: BudgetsConfig,
  siteSlug: string | null,
  pageType: string
): number {
  const own = siteSlug ? budgets.sites[siteSlug] : undefined
  return (
    own?.[pageType] ??
    budgets.pageTypes[pageType] ??
    own?.[DEFAULT_PAGE_TYPE] ??
    budgets.pageTypes[DEFAULT_PAGE_TYPE] ??
    DEFAULT_PAGE_TYPE_BUDGETS_KB[DEFAULT_PAGE_TYPE] ??
    0
  )
}

/** How far the weight of a page's blocks is over its budget, in kB with one decimal; 0 at or under it. The framework's share and the on-demand weight never count. */
export function overByKb(report: Pick<BudgetReport, 'blocksKb'>, budgetKb: number): number {
  return report.blocksKb > budgetKb ? Math.round((report.blocksKb - budgetKb) * 10) / 10 : 0
}

/** The blocks of a page, heaviest first, with their position: where an over-budget page can lose weight. */
export function heaviestBlocks(report: Pick<BudgetReport, 'blocks'>): BudgetBlock[] {
  return [...report.blocks].sort((a, b) => b.kb - a.kb || a.position - b.position)
}

/** The UIDs the budgets list as measured at publish: `budgets.contentTypes`, else the types the frontend previews. */
export function measuredTypesOf(budgets: Pick<BudgetsConfig, 'contentTypes'>): readonly string[] {
  return budgets.contentTypes ?? DEFAULT_MEASURED_TYPES
}

/** Whether a content type can be measured: it belongs to a site, is editorial and has a dynamic zone. */
export function isMeasurable(
  schema:
    | {
        attributes?: Record<string, { type?: string } | undefined>
        pluginOptions?: { micelio?: { siteScoped?: unknown; editorial?: unknown } }
      }
    | undefined
): boolean {
  const options = schema?.pluginOptions?.micelio
  if (options?.siteScoped !== true || options.editorial !== true) return false
  return Object.values(schema?.attributes ?? {}).some(
    (attribute) => attribute?.type === 'dynamiczone'
  )
}
