import { useFetchClient } from '@strapi/strapi/admin'
import { useCallback, useEffect, useState } from 'react'

import type { FrontendThemeStatus, ThemeActivationAnswer } from '../../../server/src/types/themes'
import { ANSWER_REFUSALS, outcomeOf } from '../utils/fetchError'
import { switchOutcome, themeOfPin, type ThemeRef } from '../utils/themes'

// How often the page reads the frontend's status while it waits, and for how long: the frontend
// reads the site settings again after up to a minute (its cache), then switches in the background, a
// data-only theme after a download (ADR-0009 of micelio, section 3).
const POLL_MS = 3000
const MAX_WAIT_MS = 3 * 60_000

/** Where an activation or a revert the page asked for stands. */
export type ThemeChange =
  | { kind: 'idle' }
  | { kind: 'sending'; action: 'activate' | 'revert' }
  | { kind: 'refused'; code?: string; detail?: string }
  | {
      kind: 'waiting'
      /** The theme the written pin names; `null` for the instance's default. */
      wanted: ThemeRef | null
      /** When the pin was written, by the page's clock: after `MAX_WAIT_MS` the page stops waiting. */
      startedAt: number
      /** The status the page held when the pin was written: the outcome is read from a later one. */
      since: FrontendThemeStatus | null | undefined
    }
  | { kind: 'done'; wanted: ThemeRef | null }
  | { kind: 'failed'; wanted: ThemeRef | null; message: string }
  | { kind: 'slow'; wanted: ThemeRef | null }

/**
 * Activates a theme or reverts the last activation of `site` (`POST /micelio/themes/activate` and
 * `/revert`), then reads the status through `refresh` until the frontend renders the theme asked for
 * or says why not.
 *
 * @param status - The frontend's status the page shows now, which `refresh` reads again.
 */
export function useThemeChange(
  site: string,
  status: FrontendThemeStatus | null | undefined,
  refresh: () => void
): {
  change: ThemeChange
  activate: (theme: ThemeRef) => Promise<void>
  revert: () => Promise<void>
} {
  const client = useFetchClient()
  const [change, setChange] = useState<ThemeChange>({ kind: 'idle' })

  // A change belongs to the site it was asked for.
  useEffect(() => {
    setChange({ kind: 'idle' })
  }, [site])

  useEffect(() => {
    if (change.kind !== 'waiting') return undefined
    if (status !== change.since) {
      const outcome = switchOutcome(change.wanted, status ?? null, change.since?.error ?? null)
      if (outcome.kind === 'done') {
        setChange({ kind: 'done', wanted: change.wanted })
        return undefined
      }
      if (outcome.kind === 'failed') {
        setChange({ kind: 'failed', wanted: change.wanted, message: outcome.message })
        return undefined
      }
    }
    if (Date.now() - change.startedAt >= MAX_WAIT_MS) {
      setChange({ kind: 'slow', wanted: change.wanted })
      return undefined
    }
    const timer = window.setTimeout(() => {
      refresh()
    }, POLL_MS)
    return () => window.clearTimeout(timer)
  }, [change, status, refresh])

  const send = useCallback(
    async (action: 'activate' | 'revert', body: Record<string, unknown>) => {
      setChange({ kind: 'sending', action })
      try {
        const outcome = outcomeOf<ThemeActivationAnswer>(
          await client.post(`/micelio/themes/${action}`, body, ANSWER_REFUSALS)
        )
        if (!outcome.ok) {
          setChange({ kind: 'refused', code: outcome.code, detail: outcome.detail })
          return
        }
        setChange({
          kind: 'waiting',
          wanted: themeOfPin(outcome.data.after),
          startedAt: Date.now(),
          since: status,
        })
        refresh()
      } catch {
        // No answer: the page says it failed, and nothing tells whether the pin was written.
        setChange({ kind: 'refused' })
      }
    },
    [client, refresh, status]
  )

  const activate = useCallback(
    (theme: ThemeRef) =>
      send('activate', {
        site,
        id: theme.id,
        ...(theme.version ? { version: theme.version } : {}),
      }),
    [send, site]
  )
  const revert = useCallback(() => send('revert', { site }), [send, site])
  return { change, activate, revert }
}
