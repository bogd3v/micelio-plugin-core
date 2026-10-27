import {
  WEIGHT_MAX_RETRIES,
  WEIGHT_PATH,
  WEIGHT_RETRY_CAP_SECONDS,
  WEIGHT_RETRY_DEFAULT_SECONDS,
  WEIGHT_TIMEOUT_MS,
} from '../constants/budget'
import { PREVIEW_GRANT_HEADER } from '../constants/preview'
import type { BudgetReport } from '../types/budget'
import { parseWeightReport } from './rules'

/** What a request to the frontend's weight route needs. */
export interface WeightRequest {
  /** The site's `url`, the frontend's origin. */
  siteUrl: string
  /** The content type UID of the document. */
  uid: string
  documentId: string
  /** The locale the system grant was minted for; `null` for a type that is not localised. */
  locale: string | null
}

/** What the client uses from outside, so a test can stand in for the network and the clock. */
export interface WeightDeps {
  /** Mints a new system grant for the document; called once for each attempt. */
  issueGrant(): Promise<string>
  fetch: typeof fetch
  sleep(ms: number): Promise<void>
}

/** The weight could not be measured, so the publish is refused (`previewUnavailable`). */
export class WeightUnavailableError extends Error {
  constructor(
    /** Why, without a grant or a URL. It may name hosts of the CMS's network, so it is logged and never sent to an editor. */
    readonly reason: string
  ) {
    super(reason)
    this.name = 'WeightUnavailableError'
  }
}

/** `Retry-After` as a wait in milliseconds, capped; a missing or unreadable one waits the default. */
export function retryDelayMs(header: string | null, now: Date = new Date()): number {
  const value = header?.trim() ?? ''
  let seconds = WEIGHT_RETRY_DEFAULT_SECONDS
  if (/^\d+$/.test(value)) {
    seconds = Number(value)
  } else if (value !== '' && !Number.isNaN(Date.parse(value))) {
    seconds = Math.max(0, (Date.parse(value) - now.getTime()) / 1000)
  }
  return Math.min(seconds, WEIGHT_RETRY_CAP_SECONDS) * 1000
}

/** The URL of a document's weight report in the dynamic mode, on the site's own origin and path. */
export function weightUrl(request: WeightRequest): URL {
  const url = new URL(request.siteUrl)
  const prefix = url.pathname.replace(/\/+$/, '')
  url.pathname = `${prefix}${WEIGHT_PATH}/${encodeURIComponent(request.uid)}/${encodeURIComponent(request.documentId)}/weight`
  url.search = ''
  url.hash = ''
  url.searchParams.set('mode', 'dynamic')
  // The locale the grant was minted for: the frontend serves the grant's and does not compare.
  if (request.locale) url.searchParams.set('locale', request.locale)
  return url
}

/**
 * Asks the frontend for the weight of a draft with a system grant, and answers its report.
 *
 * @remarks
 * Never estimates and never lets a publish through without the report (ADR-0019, amendment of
 * 2026-10-25). The grant goes in a header to this route and nowhere else, and the request follows
 * no redirect, since a header survives a redirect to another origin. A `429` is asked again up to
 * `WEIGHT_MAX_RETRIES` times, waiting `Retry-After` up to `WEIGHT_RETRY_CAP_SECONDS`, with a new
 * grant each time.
 *
 * @throws {@link WeightUnavailableError} when the frontend cannot be reached, redirects, answers
 * anything but a report after the retries, or answers a report that does not parse.
 */
export async function requestWeight(
  deps: WeightDeps,
  request: WeightRequest
): Promise<BudgetReport> {
  const url = weightUrl(request)
  for (let attempt = 0; ; attempt += 1) {
    const grant = await deps.issueGrant()
    let response: Response
    try {
      response = await deps.fetch(url, {
        headers: { [PREVIEW_GRANT_HEADER]: grant, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(WEIGHT_TIMEOUT_MS),
      })
    } catch (error) {
      // The error names the cause (a refused connection, a timeout, a redirect); it never holds the grant.
      const reason = (error as { cause?: { message?: unknown } }).cause?.message
      const cause = typeof reason === 'string' ? reason : ''
      throw new WeightUnavailableError(
        `The frontend did not answer the weight request: ${error instanceof Error ? error.message : 'unknown error'}${cause ? ` (${cause})` : ''}`
      )
    }
    if (response.status === 429) {
      await response.body?.cancel()
      if (attempt >= WEIGHT_MAX_RETRIES) {
        throw new WeightUnavailableError('The frontend is rate limiting the weight requests')
      }
      await deps.sleep(retryDelayMs(response.headers.get('retry-after')))
      continue
    }
    if (response.status !== 200) {
      await response.body?.cancel()
      throw new WeightUnavailableError(
        `The frontend answered ${response.status} to the weight request`
      )
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new WeightUnavailableError(
        'The frontend answered the weight request with something that is not JSON'
      )
    }
    const report = parseWeightReport(body)
    if (!report)
      throw new WeightUnavailableError(
        'The frontend answered a weight report this plugin cannot read'
      )
    return report
  }
}
