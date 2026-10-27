import type { Core, UID } from '@strapi/strapi'
import {
  heaviestBlocks,
  isMeasurable,
  budgetKbOf,
  measuredTypesOf,
  overByKb,
  pageTypeOf,
} from '../budget/rules'
import { requestWeight, WeightUnavailableError } from '../budget/weight-client'
import type { PluginConfig } from '../config'
import { TransitionError } from '../editorial/transitions'
import type { BudgetMeasurement, BudgetReport, BudgetTarget } from '../types/budget'
import type { PreviewService } from './preview'

/** The `budget` service: `strapi.plugin('micelio').service('budget')`, behind the refusal at publish. */
export interface BudgetService {
  /**
   * Whether a publish of the content type is measured: `budgets.contentTypes` lists it and it is
   * site-scoped, editorial and has a dynamic zone. Any other type publishes with no measurement.
   */
  applies(uid: string): boolean

  /**
   * Has the frontend measure the saved draft and refuses it above its budget.
   *
   * @remarks
   * For the publish path only (`performTransition`): it mints a system grant per attempt, which the
   * frontend counts in the document's own bucket, so nothing else may call it (ADR-0019, amendment
   * of 2026-10-25). The weight is the frontend's, in the dynamic mode, as a visitor would download
   * it; the plugin never estimates. The request is bound to the draft's `updatedAt`.
   *
   * @throws {@link TransitionError} `pageOverBudget` with the page's blocks, heaviest first, and by
   * how much it is over; `editorialEntryNotFound` for a draft that does not exist; and
   * `previewUnavailable` when the site has no `url` or the frontend cannot measure the draft.
   */
  assertWithinBudget(target: BudgetTarget): Promise<BudgetMeasurement>

  /**
   * Refuses when the draft was saved after it was measured, right before it is published.
   *
   * @throws {@link TransitionError} `previewUnavailable` when `updatedAt` is not the measured version.
   */
  assertUnchanged(measurement: BudgetMeasurement, target: BudgetTarget): Promise<void>
}

interface DraftRow {
  documentId: string
  locale?: string | null
  updatedAt?: string | Date | null
  pageType?: unknown
  site?: { documentId: string; slug?: string | null; url?: string | null } | null
}

const UNAVAILABLE_DETAIL =
  'The frontend could not measure the page, so it cannot be checked against its budget'

const versionOf = (draft: DraftRow) => new Date(draft.updatedAt ?? 0).toISOString()

const unavailable = (detail: string) => new TransitionError(409, 'previewUnavailable', detail)

export default ({ strapi }: { strapi: Core.Strapi }): BudgetService => {
  const previews = () => strapi.plugin('micelio').service('preview') as PreviewService
  const budgets = () => strapi.config.get<PluginConfig['budgets']>('plugin::micelio.budgets')

  async function readDraft(target: BudgetTarget): Promise<DraftRow | null> {
    return (await strapi.documents(target.uid as UID.ContentType).findOne({
      documentId: target.documentId,
      locale: target.locale ?? undefined,
      status: 'draft',
      populate: { site: { fields: ['documentId', 'slug', 'url'] } },
    } as never)) as DraftRow | null
  }

  function standingOf(draft: DraftRow, report: BudgetReport): BudgetMeasurement {
    const slug = draft.site?.slug ?? null
    const pageType = pageTypeOf(draft, budgets(), slug)
    const budgetKb = budgetKbOf(budgets(), slug, pageType)
    return {
      ...report,
      pageType,
      budgetKb,
      overByKb: overByKb(report, budgetKb),
      measuredAt: new Date().toISOString(),
      version: versionOf(draft),
    }
  }

  async function measure(target: BudgetTarget): Promise<BudgetMeasurement> {
    const draft = await readDraft(target)
    if (!draft) throw new TransitionError(404, 'editorialEntryNotFound', 'There is no such entry')
    const site = draft.site
    if (!site?.url) {
      throw unavailable('The site has no url, so there is no frontend to measure the page on')
    }
    if (!draft.updatedAt) throw unavailable('The draft has no updatedAt to bind a measurement to')
    const version = versionOf(draft)
    const locale = draft.locale ?? null
    let report
    try {
      report = await requestWeight(
        {
          issueGrant: () =>
            previews().issueSystemGrant({
              siteDocumentId: site.documentId,
              contentType: target.uid,
              entryDocumentId: draft.documentId,
              entryLocale: locale,
              entryVersion: version,
            }),
          fetch,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        },
        { siteUrl: site.url, uid: target.uid, documentId: draft.documentId, locale }
      )
    } catch (error) {
      if (!(error instanceof WeightUnavailableError)) throw error
      // The cause names hosts of the CMS's network: the log keeps it, the editor gets a fixed sentence.
      strapi.log.warn(
        `micelio: could not measure ${target.uid} ${draft.documentId} for its budget: ${error.reason}`
      )
      throw unavailable(UNAVAILABLE_DETAIL)
    }
    return standingOf(draft, report)
  }

  return {
    applies: (uid) =>
      measuredTypesOf(budgets()).includes(uid) &&
      isMeasurable(strapi.contentType(uid as UID.ContentType)),

    async assertWithinBudget(target) {
      const measurement = await measure(target)
      if (measurement.overByKb > 0) {
        throw new TransitionError(
          409,
          'pageOverBudget',
          `The blocks of the page weigh ${measurement.blocksKb} kB and the budget of a ${measurement.pageType} page is ${measurement.budgetKb} kB, ${measurement.overByKb} kB over`,
          {
            pageType: measurement.pageType,
            budgetKb: measurement.budgetKb,
            blocksKb: measurement.blocksKb,
            frameworkKb: measurement.frameworkKb,
            totalKb: measurement.totalKb,
            overByKb: measurement.overByKb,
            blocks: heaviestBlocks(measurement).map(({ position, id, kb }) => ({
              position,
              id,
              kb,
            })),
          }
        )
      }
      return measurement
    },

    async assertUnchanged(measurement, target) {
      const current = await readDraft(target)
      const version = current?.updatedAt ? new Date(current.updatedAt).toISOString() : null
      if (version !== measurement.version) {
        throw unavailable('The page was saved while it was measured; publish it again')
      }
    },
  }
}
