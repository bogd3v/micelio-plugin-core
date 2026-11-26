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
import { REFERENCE_MEASURE_CONCURRENCY } from '../constants/budget'
import { TransitionError } from '../editorial/transitions'
import { referenceFields, reusableBlockDraftVersion, storedReferences } from '../reusable-blocks'
import type { ReferencingPage } from '../reusable-blocks/error'
import type { BudgetMeasurement, BudgetReport, BudgetTarget } from '../types/budget'
import type { PreviewService } from './preview'
import type { ReusableBlocksService } from './reusable-blocks'

/** A page named by a refusal of a reusable block's publish: the `page` member of its problem detail. */
type RefusedPage = Pick<ReferencingPage, 'uid' | 'documentId' | 'locale' | 'title'>

/** The version of a reusable block's draft its pages were measured with, checked again before the write. */
export interface ReferenceMeasurement {
  /** The `updatedAt` of the reusable block's draft in the locale published, as an ISO 8601 date. */
  version: string
}

/** The `budget` service: `strapi.plugin('micelio').service('budget')`, behind the cost meter and the refusal at publish. */
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
   * Places a report the admin got from the frontend with the editor's own grant against the budget
   * of the saved draft, for the cost meter.
   *
   * @remarks
   * Mints no grant and calls no frontend: the report is the editor's to show and carries no weight
   * at publish, which measures the draft itself (`assertWithinBudget`).
   *
   * @throws {@link TransitionError} `editorialEntryNotFound` for a draft that does not exist.
   */
  standing(target: BudgetTarget, report: BudgetReport): Promise<BudgetMeasurement>

  /**
   * Refuses when the draft was saved after it was measured, right before it is published.
   *
   * @throws {@link TransitionError} `previewUnavailable` when `updatedAt` is not the measured version.
   */
  assertUnchanged(measurement: BudgetMeasurement, target: BudgetTarget): Promise<void>

  /**
   * Has the frontend measure each published page that shows a reusable block, with the block's
   * draft in place of its reference, and refuses at the first page over its budget.
   *
   * @remarks
   * For the publish path of `plugin::micelio.reusable-block` only (`performTransition`; ADR-0019 and
   * ADR-0022, amendments of 2026-11-23). The pages are those of `usedOn` in the locale published
   * whose published version, in that locale, references the block, of a type this service
   * `applies` to. Each is measured with a system grant bound to the reference, its weight request
   * marked `measure=reference`, at most `REFERENCE_MEASURE_CONCURRENCY` at once and with no cap on
   * their number. The pages are read, never written.
   *
   * @returns The block's version that was measured, or `null` when no page needs measuring.
   * @throws {@link TransitionError} `pageOverBudget` with the members of a page's own refusal and
   * `page`, for the first page (in the order of `usedOn`) over its budget; `previewUnavailable` with
   * `page` when a page cannot be measured, or its measurement is refused for any other reason (its
   * published version gone since it was listed); `editorialEntryNotFound` when the block has no draft.
   */
  assertPagesWithinBudget(block: BudgetTarget): Promise<ReferenceMeasurement | null>

  /**
   * Refuses when the reusable block's draft was saved after its pages were measured, right before
   * it is published.
   *
   * @throws {@link TransitionError} `previewUnavailable` when `updatedAt` is not the measured version.
   */
  assertReferenceUnchanged(measurement: ReferenceMeasurement, block: BudgetTarget): Promise<void>
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

  async function readDraft(
    target: BudgetTarget,
    status: 'draft' | 'published' = 'draft'
  ): Promise<DraftRow | null> {
    return (await strapi.documents(target.uid as UID.ContentType).findOne({
      documentId: target.documentId,
      locale: target.locale ?? undefined,
      status,
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

  /**
   * The frontend's report of a draft, or with `reference` of a page's published version with the
   * reusable block's draft in place of its reference.
   */
  async function measure(
    target: BudgetTarget,
    reference?: { documentId: string; version: string }
  ): Promise<BudgetMeasurement> {
    const draft = await readDraft(target, reference ? 'published' : 'draft')
    if (!draft) throw new TransitionError(404, 'editorialEntryNotFound', 'There is no such entry')
    const site = draft.site
    if (!site?.url) {
      throw unavailable('The site has no url, so there is no frontend to measure the page on')
    }
    if (!draft.updatedAt) throw unavailable('The draft has no updatedAt to bind a measurement to')
    const locale = draft.locale ?? null
    const bound = reference
      ? { reusableBlock: { documentId: reference.documentId, version: reference.version } }
      : { entryVersion: versionOf(draft) }
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
              ...bound,
            }),
          fetch,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        },
        {
          siteUrl: site.url,
          uid: target.uid,
          documentId: draft.documentId,
          locale,
          ...(reference ? { boundToReference: true } : {}),
        }
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

  /** Refuses `measurement` above its budget with `pageOverBudget`, with `extra` members. */
  function assertWithin(measurement: BudgetMeasurement, extra: Record<string, unknown> = {}) {
    if (measurement.overByKb <= 0) return
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
        blocks: heaviestBlocks(measurement).map(({ position, id, kb }) => ({ position, id, kb })),
        ...extra,
      }
    )
  }

  /** The published pages of a measured type whose published version in `locale` references the block. */
  async function pagesToMeasure(block: string, locale: string | null): Promise<RefusedPage[]> {
    const reusable = strapi.plugin('micelio').service('reusableBlocks') as ReusableBlocksService
    const used = await reusable.usedOn({ documentId: block, locale: locale ?? undefined })
    const fields = referenceFields(strapi)
    const pages: RefusedPage[] = []
    for (const page of used) {
      if (!page.published || page.locale !== locale || !applies(page.uid)) continue
      // `published` says the page has a published version; whether that version shows the block,
      // the draft route checks too, so a page that does not is never asked for.
      const live = await storedReferences(
        strapi,
        page.uid,
        fields.filter((field) => field.uid === page.uid),
        { documentId: page.documentId, locale: page.locale ?? undefined, published: true }
      )
      if (!live.includes(block)) continue
      pages.push({
        uid: page.uid,
        documentId: page.documentId,
        locale: page.locale,
        title: page.title,
      })
    }
    return pages
  }

  async function blockVersionOf(block: BudgetTarget): Promise<string | undefined> {
    const draft = await readDraft(block)
    if (!draft?.site) return undefined
    return reusableBlockDraftVersion(strapi, {
      documentId: block.documentId,
      locale: draft.locale ?? null,
      siteDocumentId: draft.site.documentId,
    })
  }

  function applies(uid: string): boolean {
    return (
      measuredTypesOf(budgets()).includes(uid) &&
      isMeasurable(strapi.contentType(uid as UID.ContentType))
    )
  }

  return {
    applies,

    async standing(target, report) {
      const draft = await readDraft(target)
      if (!draft) throw new TransitionError(404, 'editorialEntryNotFound', 'There is no such entry')
      return standingOf(draft, report)
    },

    async assertWithinBudget(target) {
      const measurement = await measure(target)
      assertWithin(measurement)
      return measurement
    },

    async assertPagesWithinBudget(block) {
      const version = await blockVersionOf(block)
      if (!version)
        throw new TransitionError(404, 'editorialEntryNotFound', 'There is no such entry')
      const pages = await pagesToMeasure(block.documentId, block.locale ?? null)
      if (pages.length === 0) return null
      const reference = { documentId: block.documentId, version }
      // A few at a time, in the order of `usedOn`: the refusal names the first page that fails.
      for (let start = 0; start < pages.length; start += REFERENCE_MEASURE_CONCURRENCY) {
        const batch = pages.slice(start, start + REFERENCE_MEASURE_CONCURRENCY)
        const settled = await Promise.allSettled(
          batch.map(async (page) => assertWithin(await measure(page, reference), { page }))
        )
        for (const [index, outcome] of settled.entries()) {
          if (outcome.status === 'fulfilled') continue
          const error: unknown = outcome.reason
          if (!(error instanceof TransitionError) || error.code === 'pageOverBudget') throw error
          // Any other refusal of a page (a published version gone since it was listed) is a page
          // that could not be measured: the block's publish names it, never the page's own code.
          const detail =
            error.code === 'previewUnavailable'
              ? error.message
              : 'The page could not be read to measure it; publish again'
          throw new TransitionError(409, 'previewUnavailable', detail, { page: batch[index] })
        }
      }
      return { version }
    },

    async assertReferenceUnchanged(measurement, block) {
      if ((await blockVersionOf(block)) !== measurement.version) {
        throw unavailable(
          'The reusable block was saved while its pages were measured; publish it again'
        )
      }
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
