import { useFetchClient } from '@strapi/strapi/admin'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ThemesAnswer } from '../../../server/src/types/themes'

/** What a page of the themes can be showing. */
export type ThemesState =
  { kind: 'loading' } | { kind: 'ready'; data: ThemesAnswer } | { kind: 'error' }

/**
 * Loads `GET /micelio/themes?site=` (the default site when `site` is `null`), and again on `reload()`
 * (the page shows its loading state meanwhile) or `refresh()` (the page keeps what it shows until the
 * new answer arrives, as while it waits for the frontend to switch).
 */
export function useThemes(site: string | null): {
  state: ThemesState
  reload: () => void
  refresh: () => void
} {
  // The client is rebuilt on every render; the effect must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [state, setState] = useState<ThemesState>({ kind: 'loading' })
  const [count, setCount] = useState(0)
  const isQuietRef = useRef(false)

  useEffect(() => {
    let isCurrent = true
    if (!isQuietRef.current) setState({ kind: 'loading' })
    isQuietRef.current = false
    void (async () => {
      try {
        const query = site ? `?site=${encodeURIComponent(site)}` : ''
        const response = await clientRef.current.get<{ data: ThemesAnswer }>(
          `/micelio/themes${query}`
        )
        if (isCurrent) setState({ kind: 'ready', data: response.data.data })
      } catch {
        // A refusal or no answer: the page offers to try again.
        if (isCurrent) setState({ kind: 'error' })
      }
    })()
    return () => {
      isCurrent = false
    }
  }, [site, count])

  const reload = useCallback(() => setCount((value) => value + 1), [])
  const refresh = useCallback(() => {
    isQuietRef.current = true
    setCount((value) => value + 1)
  }, [])
  return { state, reload, refresh }
}
