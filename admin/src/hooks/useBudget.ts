import { useFetchClient } from '@strapi/strapi/admin'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { BudgetMeasurement } from '../../../server/src/types/budget'
import { statusOf } from '../utils/fetchError'

/** Why there is no measurement. */
export type BudgetError = 'unsupported' | 'forbidden' | 'unavailable' | 'busy' | 'failed'

/** What the cost meter knows of the page. */
export type BudgetResource =
  | { kind: 'loading' }
  | { kind: 'ready'; measurement: BudgetMeasurement }
  | { kind: 'error'; reason: BudgetError }

/** How long the frontend has to answer the weight route, in milliseconds: a render of the draft takes seconds. */
const FETCH_TIMEOUT_MS = 30_000

const REASONS: Record<number, BudgetError> = {
  400: 'unsupported',
  403: 'forbidden',
}

/**
 * Reads the weight of the saved draft from the frontend with the editor's own preview grant, and
 * asks `POST /micelio/budget/measure` where it stands against its budget (ADR-0019, amendment of
 * 2026-10-25). It asks again when `version` (the draft's `updatedAt`) or the locale changes, or
 * `measureAgain()` runs.
 *
 * @remarks
 * The grant is the frame's: the frontend keeps it in an `HttpOnly` cookie that only a request from
 * the admin's origin to the frontend's, with credentials, carries, so the report is asked for with a
 * plain `fetch` and never with the admin's client, whose requests carry the admin's own token. The
 * plugin mints no grant for the meter. It waits for `weightUrl`, which is known once the frame has
 * loaded (`ready`) and so holds the grant. A new version or `measureAgain()` shows
 * `loading` again until the next report arrives.
 *
 * @param weightUrl - The weight route of the document on the site (`weightRoute`), or `undefined`
 * while the frame has not loaded.
 */
export function useBudget(
  uid: string,
  documentId: string,
  locale: string | null,
  version: string | undefined,
  weightUrl: string | undefined
): { resource: BudgetResource; measureAgain: () => void } {
  // The client is rebuilt on every render; the effect must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [resource, setResource] = useState<BudgetResource>({ kind: 'loading' })
  const [count, setCount] = useState(0)
  // A type the CMS does not measure stays so: asking again would render the draft for nothing.
  const unsupportedKey = useRef<string>()

  useEffect(() => {
    // The entry is still loading, or the frame has not loaded and holds no grant yet.
    if (version === undefined || weightUrl === undefined) return
    if (unsupportedKey.current === `${uid}/${documentId}`) return
    let isCurrent = true
    void (async () => {
      try {
        const report = await fetch(weightUrl, {
          credentials: 'include',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!report.ok) {
          if (isCurrent) {
            setResource({ kind: 'error', reason: report.status === 429 ? 'busy' : 'unavailable' })
          }
          return
        }
        const response = await clientRef.current.post<{ data: BudgetMeasurement }>(
          '/micelio/budget/measure',
          { uid, documentId, locale, report: await report.json() }
        )
        if (isCurrent) setResource({ kind: 'ready', measurement: response.data.data })
      } catch (error) {
        // A refusal of the CMS has a status; a request to the frontend that the browser refused or that failed has none.
        const status = statusOf(error)
        if (status === 400) unsupportedKey.current = `${uid}/${documentId}`
        if (isCurrent) {
          setResource({
            kind: 'error',
            reason: status === undefined ? 'unavailable' : (REASONS[status] ?? 'failed'),
          })
        }
      }
    })()
    return () => {
      isCurrent = false
    }
  }, [uid, documentId, locale, version, weightUrl, count])

  const measureAgain = useCallback(() => {
    setResource({ kind: 'loading' })
    setCount((value) => value + 1)
  }, [])
  return { resource, measureAgain }
}
