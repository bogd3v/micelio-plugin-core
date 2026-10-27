import type { BudgetBlock } from '../../../server/src/types/budget'
import { formatKb } from './costMeter'
import { previewPagePath } from './previewAction'

/** How many of the heaviest blocks the notification names. */
const NAMED_BLOCKS = 3

/** The entry whose publish was refused. */
export interface RefusedEntry {
  uid: string
  documentId: string
  /** `null` for a type that is not localised. */
  locale: string | null
}

/** What a notification says of a refused publish: a message of the plugin's translations and where to look. */
export interface RefusalNotice {
  /** A key of `translations/en.json` and the values that fill it. */
  message: { id: string; values: Record<string, string | number> }
  /** The admin path of the preview page of the entry, where the cost meter lists every block. */
  previewPath: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function toBlocks(value: unknown): Pick<BudgetBlock, 'id' | 'kb'>[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((block) =>
    isRecord(block) && typeof block.id === 'string' && typeof block.kb === 'number'
      ? [{ id: block.id, kb: block.kb }]
      : []
  )
}

/**
 * The notification for a publish that `POST /micelio/transitions` refused, from the problem detail
 * it answered (`docs/api.md`): the blocks that weigh the most and by how much the page is over its
 * budget for `pageOverBudget`, the cause for `previewUnavailable`.
 *
 * @remarks
 * The problem detail is `unknown` until narrowed here. A refusal that is neither answers
 * `undefined`: the control that made the request has its own text for it. The branch is on `code`,
 * never on the text; the `detail` of `previewUnavailable` is a fixed sentence of the plugin.
 */
export function refusalNotice(problem: unknown, entry: RefusedEntry): RefusalNotice | undefined {
  if (!isRecord(problem)) return undefined
  const previewPath = previewPagePath(entry.uid, entry.documentId, entry.locale)
  if (problem.code === 'previewUnavailable') {
    const cause = typeof problem.detail === 'string' ? problem.detail : ''
    return { message: { id: 'refusal.previewUnavailable', values: { cause } }, previewPath }
  }
  if (
    problem.code === 'pageOverBudget' &&
    typeof problem.overByKb === 'number' &&
    typeof problem.budgetKb === 'number' &&
    typeof problem.blocksKb === 'number'
  ) {
    const blocks = toBlocks(problem.blocks)
      .slice(0, NAMED_BLOCKS)
      .map(({ id, kb }) => `${id} (${formatKb(kb)} kB)`)
      .join(', ')
    return {
      message: {
        id: 'refusal.pageOverBudget',
        values: {
          weight: formatKb(problem.blocksKb),
          budget: formatKb(problem.budgetKb),
          over: formatKb(problem.overByKb),
          blocks,
        },
      },
      previewPath,
    }
  }
  return undefined
}

/** The notification of the admin for a refused publish, in the shape `toggleNotification` takes. */
export interface RefusalNotification {
  type: 'danger'
  title: string
  message: string
  link: { label: string; url: string }
  timeout: number
}

/** How long the notification stays, in milliseconds: the editor reads a list of blocks and follows a link. */
const NOTIFICATION_MS = 15_000

/**
 * The notification for a refused publish, translated, with the link to the preview page under the
 * admin's `root` path (`/admin`, or `''` when it is served at the top), or `undefined` when the
 * refusal is not a budget one.
 *
 * @param t - The translator of the plugin's strings (`useMessages`).
 */
export function refusalNotification(
  problem: unknown,
  entry: RefusedEntry,
  root: string,
  t: (id: string, values?: Record<string, string | number>) => string
): RefusalNotification | undefined {
  const notice = refusalNotice(problem, entry)
  if (!notice) return undefined
  return {
    type: 'danger',
    title: t('refusal.title'),
    message: t(notice.message.id, notice.message.values),
    link: { label: t('refusal.link'), url: `${root}${notice.previewPath}` },
    timeout: NOTIFICATION_MS,
  }
}
