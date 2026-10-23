import { useFetchClient } from '@strapi/strapi/admin'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { StatusReport } from '../../../server/src/types/status'

/** What the status page can be showing. */
export type StatusResource =
  { kind: 'loading' } | { kind: 'ready'; data: StatusReport } | { kind: 'error' }

/** Loads `GET /micelio/status`, and loads it again on `reload()`. */
export function useStatus(): { resource: StatusResource; reload: () => void } {
  // The client is rebuilt on every render; the effect must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [resource, setResource] = useState<StatusResource>({ kind: 'loading' })
  const [count, setCount] = useState(0)

  useEffect(() => {
    let isCurrent = true
    void (async () => {
      try {
        const response = await clientRef.current.get<{ data: StatusReport }>('/micelio/status')
        if (isCurrent) setResource({ kind: 'ready', data: response.data.data })
      } catch {
        // A refusal or no answer: the page offers to try again.
        if (isCurrent) setResource({ kind: 'error' })
      }
    })()
    return () => {
      isCurrent = false
    }
  }, [count])

  const reload = useCallback(() => {
    setResource({ kind: 'loading' })
    setCount((value) => value + 1)
  }, [])
  return { resource, reload }
}
