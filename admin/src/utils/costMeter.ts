import type { BudgetBlock } from '../../../server/src/types/budget'

/** The share of the budget where the meter turns from calm to near: 90 %. */
export const NEAR_RATIO = 0.9

/** Where a page stands against its budget: under 90 %, from 90 % up to the budget, or over it. */
export type MeterLevel = 'ok' | 'near' | 'over'

/**
 * The level of the weight of a page's blocks against its budget.
 *
 * @remarks
 * The colour changes at the thresholds and not along the way. A page exactly on its budget is
 * `near`, since it publishes: only a weight above the budget is `over`, as the publish decides.
 * The framework's share and the on-demand weight are not part of `blocksKb`, so they never move the level.
 */
export function meterLevel(blocksKb: number, budgetKb: number): MeterLevel {
  if (blocksKb > budgetKb) return 'over'
  // In tenths of a kB: `13 * 0.9` is 11.700000000000001, so the product would put a page at exactly 90 % in `ok`.
  return tenths(blocksKb) * 10 >= tenths(budgetKb) * Math.round(NEAR_RATIO * 10) ? 'near' : 'ok'
}

const tenths = (kb: number) => Math.round(kb * 10)

/** How much of the track the bar fills, from 0 to 100 (a page over its budget fills it). */
export function meterPercent(blocksKb: number, budgetKb: number): number {
  if (budgetKb <= 0) return 100
  return Math.min(100, Math.round((blocksKb / budgetKb) * 1000) / 10)
}

/** A weight in kB with one decimal and no trailing zero: `42`, `42.5`. */
export function formatKb(kb: number): string {
  return String(Math.round(kb * 10) / 10)
}

/** The blocks that carry on-demand weight, heaviest first: what the page loads only once used. */
export function onDemandBlocks(blocks: BudgetBlock[]): BudgetBlock[] {
  return blocks.filter((block) => block.onDemandKb > 0).sort((a, b) => b.onDemandKb - a.onDemandKb)
}

/** Where the frontend's weight routes live, on the site's own origin and path (`WEIGHT_PATH` of the server). */
const WEIGHT_PATH = '/api/preview'

/**
 * The URL of a document's weight report in the dynamic mode, from the URL the preview opens
 * (`<site.url>/_preview?token=…`), or `undefined` when it is not one.
 *
 * @remarks
 * It drops the token: the report is asked for with the grant the frame already holds, in its cookie.
 */
export function weightRoute(
  previewUrl: string,
  uid: string,
  documentId: string,
  locale: string | null
): string | undefined {
  let url: URL
  try {
    url = new URL(previewUrl)
  } catch {
    return undefined
  }
  const prefix = url.pathname.replace(/\/_preview\/?$/, '').replace(/\/+$/, '')
  url.pathname = `${prefix}${WEIGHT_PATH}/${encodeURIComponent(uid)}/${encodeURIComponent(documentId)}/weight`
  url.search = ''
  url.hash = ''
  url.searchParams.set('mode', 'dynamic')
  if (locale) url.searchParams.set('locale', locale)
  return url.toString()
}

/**
 * Whether a measurement was made of the draft the entry shows now: the two timestamps name the same
 * instant, whatever their format. An unknown or unparseable `current` reads as a different draft.
 */
export function isSameVersion(measured: string, current: string | undefined): boolean {
  return current !== undefined && new Date(measured).getTime() === new Date(current).getTime()
}
