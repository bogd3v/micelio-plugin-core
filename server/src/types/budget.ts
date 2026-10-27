/** The share of one block of a draft in a measurement. */
export interface BudgetBlock {
  /** Where the block sits in the page's dynamic zone, from 1. */
  position: number
  /** The block's catalogue id (ADR-0018), such as `hero`. */
  id: string
  /** What the page weighs more with the block than without it, in kB as sent. */
  kb: number
  /** The script the block's island loads only once it is used, in kB; 0 for a block with none. */
  onDemandKb: number
}

/** What the frontend's weight report says of a draft, in kB (1024 bytes) as sent. */
export interface BudgetReport {
  /** HTML, CSS, JS, fonts and images: what the page sends at load. Never includes `onDemandKb`. */
  totalKb: number
  /**
   * What the page's blocks add to `totalKb` (the sum of `blocks[].kb`, one decimal): what the budget
   * is measured against, since it is what an editor controls.
   */
  blocksKb: number
  /** What every page of the site sends whatever its blocks (`totalKb - blocksKb`): the framework's script, styles and fonts. */
  frameworkKb: number
  /** The script the page's islands load only once one is used, apart from `totalKb`. */
  onDemandKb: number
  htmlKb: number
  cssKb: number
  jsKb: number
  fontKb: number
  imagesKb: number
  /** One entry per block of the page, in order. */
  blocks: BudgetBlock[]
}

/** A draft measured against its budget (`POST /micelio/budget/measure`, `docs/operate/budgets.md`). */
export interface BudgetMeasurement extends BudgetReport {
  /** The page type whose budget applies. */
  pageType: string
  /** The budget of the page type for the site, in kB, against `blocksKb`. */
  budgetKb: number
  /** How far `blocksKb` is over `budgetKb`, in kB; 0 when it is not over. */
  overByKb: number
  /** When the measurement was made, as an ISO 8601 date. */
  measuredAt: string
  /** The `updatedAt` of the draft that was measured, as an ISO 8601 date. */
  version: string
}

/** The draft to measure. */
export interface BudgetTarget {
  /** A site-scoped, editorial content type with a dynamic zone. */
  uid: string
  documentId: string
  /** Omitted or `null`: the default locale, or no locale for a type that is not localised. */
  locale?: string | null
}
