import { useFetchClient } from '@strapi/strapi/admin'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { SiteSectionSummary, SiteWithSections } from '../../../server/src/types/status'

/** What `GET /micelio/sites` answers: the sites and the sections the caller may read. */
export interface SitesAnswer {
  sites: SiteWithSections[]
  sections: SiteSectionSummary[]
}

/** What the Sites page can be showing. */
export type SitesState =
  { kind: 'loading' } | { kind: 'ready'; data: SitesAnswer } | { kind: 'error' }

/**
 * Loads `GET /micelio/sites` once, and again on `reload()` (the page shows its loading state
 * meanwhile) or `refresh()` (the page keeps what it shows until the new answer arrives).
 */
export function useSites(): { state: SitesState; reload: () => void; refresh: () => void } {
  // The client is rebuilt on every render; the effect must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [state, setState] = useState<SitesState>({ kind: 'loading' })
  const [count, setCount] = useState(0)
  const isQuietRef = useRef(false)

  useEffect(() => {
    let isCurrent = true
    if (!isQuietRef.current) setState({ kind: 'loading' })
    isQuietRef.current = false
    void (async () => {
      try {
        const response = await clientRef.current.get<{
          data: SiteWithSections[]
          meta?: { sections?: SiteSectionSummary[] }
        }>('/micelio/sites')
        if (isCurrent) {
          setState({
            kind: 'ready',
            data: { sites: response.data.data, sections: response.data.meta?.sections ?? [] },
          })
        }
      } catch {
        // A refusal or no answer: the page offers to try again.
        if (isCurrent) setState({ kind: 'error' })
      }
    })()
    return () => {
      isCurrent = false
    }
  }, [count])

  const reload = useCallback(() => setCount((value) => value + 1), [])
  const refresh = useCallback(() => {
    isQuietRef.current = true
    setCount((value) => value + 1)
  }, [])
  return { state, reload, refresh }
}
