import type { EditorialState } from '../../../server/src/constants/editorial'
import { refusalNotice, type RefusedEntry } from './refusal'

export type { EditorialState }

/** What a button of the builder asks the server for, and the dialog it opens first, if any. */
export interface ReviewAction {
  /** The key of the button's label, `review.action.<id>`, in the translations. */
  id:
    'sendToReview' | 'schedule' | 'unschedule' | 'sendBack' | 'publish' | 'republish' | 'unpublish'
  to: EditorialState
  dialog?: 'review' | 'schedule' | 'sendBack'
  /** The one action of a state the toolbar shows as its primary button. */
  isPrimary: boolean
}

const ACTIONS: Record<EditorialState, ReviewAction[]> = {
  draft: [
    { id: 'schedule', to: 'scheduled', dialog: 'schedule', isPrimary: false },
    { id: 'sendToReview', to: 'in_review', dialog: 'review', isPrimary: true },
  ],
  in_review: [
    { id: 'sendBack', to: 'draft', dialog: 'sendBack', isPrimary: false },
    { id: 'publish', to: 'published', isPrimary: true },
  ],
  scheduled: [{ id: 'unschedule', to: 'draft', isPrimary: false }],
  published: [
    { id: 'unpublish', to: 'draft', isPrimary: false },
    { id: 'republish', to: 'published', isPrimary: true },
  ],
}

/**
 * The transitions the builder offers from a state: those of the state machine a user performs
 * (`server/src/editorial/machine.ts`), never the scheduler's own. The server decides each one: a
 * role the site's policy leaves out gets `editorialTransitionForbidden`.
 */
export function actionsFor(state: EditorialState): ReviewAction[] {
  return ACTIONS[state]
}

/** Where a refusal points: a block of the page's zone, by catalogue id and place from 0. */
export interface BlockTarget {
  block: string
  position: number
}

/** What the admin says of a refusal or a warning of a transition, before it is translated. */
export interface TransitionNotice {
  type: 'danger' | 'warning'
  code: string
  /** Keys of `translations/en.json`. */
  title: string
  message: string
  values: Record<string, string | number>
  /** The first block the problem names, for the link "Go to the block". */
  target?: BlockTarget
  /** The preview page of the entry, for a refusal that names no block (`previewUnavailable`). */
  previewPath?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The blocks a problem names: `{ block, position }` from 0, or the budget's `{ id, position }` from 1. */
function blocksOf(problem: Record<string, unknown>): (BlockTarget & Record<string, unknown>)[] {
  if (!Array.isArray(problem.blocks)) return []
  const fromOne = problem.code === 'pageOverBudget'
  return problem.blocks.flatMap((item) => {
    if (!isRecord(item) || typeof item.position !== 'number') return []
    const block = typeof item.block === 'string' ? item.block : item.id
    if (typeof block !== 'string') return []
    return [{ ...item, block, position: fromOne ? item.position - 1 : item.position }]
  })
}

const KNOWN = new Set([
  'pageOverBudget',
  'previewUnavailable',
  'editorialTransitionForbidden',
  'editorialPublishAtInvalid',
  'islandAlternativeMissing',
  'sampleTextPresent',
  'seoInvalid',
  'linkToDraft',
  'descriptionRepeatsTitle',
])

/** The codes of warnings: the transition went through. */
const WARNINGS = new Set(['linkToDraft', 'descriptionRepeatsTitle'])

/**
 * The text of a notice, ending with the code of the problem it reads (`· pageOverBudget`), as every
 * refusal of the review flow shows it.
 *
 * @remarks
 * Most messages of the flow carry their code already; the budget's come from `refusalNotice`, which
 * the cost meter shares, and carry none. A request that never reached the server (`failed`) has no
 * code to show.
 */
export function withCode(text: string, code: string): string {
  return code === 'failed' || text.endsWith(code) ? text : `${text} · ${code}`
}

/**
 * What to tell the editor about a problem detail of `POST /micelio/transitions`: a refusal, or a
 * warning of `warnings` (`linkToDraft`), with the first block it names.
 *
 * @remarks
 * The branch is on `code`, never on the text; a code the admin has no message for shows the
 * server's `detail`. The budget's refusals (`pageOverBudget`, `previewUnavailable`) take their text
 * from `refusalNotice` (issue #106): the weights in the editor's `locale` and the heaviest blocks.
 *
 * @param page - The entry the transition moved, for the budget's text and the preview's link.
 */
export function transitionNotice(
  problem: unknown,
  locale: string,
  page?: RefusedEntry
): TransitionNotice {
  const members = isRecord(problem) ? problem : {}
  const code = typeof members.code === 'string' ? members.code : 'failed'
  const detail = typeof members.detail === 'string' ? members.detail : ''
  const blocks = blocksOf(members)
  const first = blocks[0]
  const target = first ? { block: first.block, position: first.position } : undefined
  const type = WARNINGS.has(code) ? 'warning' : 'danger'
  if (!KNOWN.has(code)) {
    return {
      type,
      code,
      title: 'review.refusal.title',
      message: 'review.refusal.other',
      values: { detail },
    }
  }
  const values: Record<string, string | number> = { detail, count: blocks.length }
  if (first) {
    values.block = first.block
    values.position = first.position + 1
  }
  const budget = page ? refusalNotice(problem, page, locale) : undefined
  if (budget) {
    return {
      type,
      code,
      title: `review.refusal.${code}.title`,
      message: budget.message.id,
      values: budget.message.values,
      target,
      previewPath: target ? undefined : budget.previewPath,
    }
  }
  if (code === 'pageOverBudget' || code === 'previewUnavailable') {
    // Without the members `refusalNotice` reads, or the page: the server's own sentence.
    const title = `review.refusal.${code}.title`
    return { type, code, title, message: 'review.refusal.other', values: { detail }, target }
  }
  if (code === 'islandAlternativeMissing' || code === 'sampleTextPresent') {
    values.fields = Array.isArray(first?.fields) ? first.fields.join(', ') : ''
  }
  if (code === 'seoInvalid') {
    // The codes of the problems, which `useTransition` turns into the editor's own words.
    values.problems = Array.isArray(members.problems)
      ? members.problems
          .flatMap((item) => (isRecord(item) && typeof item.code === 'string' ? [item.code] : []))
          .join(',')
      : ''
  }
  if (code === 'linkToDraft') {
    const pages = blocks.flatMap((item) =>
      isRecord(item.page) && typeof item.page.title === 'string' ? [item.page.title] : []
    )
    values.pages = [...new Set(pages)].join(', ')
  }
  return {
    type,
    code,
    title: `review.refusal.${code}.title`,
    message: `review.refusal.${code}`,
    values,
    target,
  }
}

/** The warnings of an answer of `POST /micelio/transitions`, each a problem detail. */
export function warningsOf(answer: unknown): unknown[] {
  const data = isRecord(answer) && isRecord(answer.data) ? answer.data : undefined
  return Array.isArray(data?.warnings) ? data.warnings : []
}

/** The builder's path for a page, with the block a refusal names selected when it opens. */
export function builderPath(
  page: { uid: string; documentId: string; locale: string | null },
  target?: BlockTarget
): string {
  const params = new URLSearchParams()
  if (page.locale) params.set('locale', page.locale)
  if (target) {
    params.set('block', target.block)
    params.set('position', String(target.position))
  }
  const query = params.toString()
  return `/plugins/micelio/builder/${page.uid}/${page.documentId}${query ? `?${query}` : ''}`
}

const MINUTE = 60_000

/** The time zone of the browser, an IANA name. */
export function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Whether `zone` is an IANA time zone this browser knows. */
export function isZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** The wall-clock fields of an instant in `zone`, read as if they were UTC (ms since the epoch). */
function wallOf(ms: number, zone: string): number {
  let format = formatters.get(zone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(zone, format)
  }
  const fields: Record<string, number> = {}
  for (const part of format.formatToParts(ms)) fields[part.type] = Number(part.value)
  return Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second
  )
}

/** The offset of `zone` from UTC at an instant, in ms. */
const offsetAt = (ms: number, zone: string): number => wallOf(ms, zone) - ms

/**
 * The value of a `datetime-local` input, `YYYY-MM-DDTHH:mm`, for an instant read in the IANA
 * `zone`: the schedule dialog shows the time of the site's readers, not the editor's.
 */
export function toZonedInput(date: Date, zone: string): string {
  return new Date(wallOf(date.getTime(), zone)).toISOString().slice(0, 16)
}

/**
 * The instant a `date` and `time` input pair names in the IANA `zone`, as an ISO 8601 string, or
 * `undefined` for an input that is not a date and a time.
 *
 * @remarks
 * A daylight saving change makes some wall times ambiguous or absent, and each resolves to one
 * instant: a time that occurs twice (the clocks go back) is the earlier of the two, and a time that
 * does not occur (the clocks go forward) is the first minute after the missing hour, the moment the
 * change takes place.
 */
export function instantOf(date: string, time: string, zone: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return undefined
  const wall = new Date(`${date}T${time}:00Z`).getTime()
  if (Number.isNaN(wall) || new Date(wall).toISOString().slice(0, 16) !== `${date}T${time}`) {
    return undefined
  }
  // The offsets a day before and after the wall time bracket any change of that day.
  const before = offsetAt(wall - 24 * 3_600_000, zone)
  const after = offsetAt(wall + 24 * 3_600_000, zone)
  const matches = [...new Set([before, after])]
    .map((offset) => wall - offset)
    .filter((ms) => wallOf(ms, zone) === wall)
  if (matches.length > 0) return new Date(Math.min(...matches)).toISOString()
  // Missing: the clocks went forward over this time. The change is the first minute that has the
  // later offset, between the instant read with the earlier offset and with the later one.
  let low = wall - after
  let high = wall - before
  while (high - low > MINUTE) {
    const middle = low + Math.floor((high - low) / 2 / MINUTE) * MINUTE
    if (offsetAt(middle, zone) === before) low = middle
    else high = middle
  }
  return new Date(high).toISOString()
}
