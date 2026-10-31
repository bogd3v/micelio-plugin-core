import { useFetchClient } from '@strapi/strapi/admin'
import { useCallback, useEffect, useRef, useState } from 'react'

/** What a page that loads one resource can be showing. */
export type Loaded<T> = { kind: 'loading' } | { kind: 'ready'; data: T } | { kind: 'error' }

/**
 * Loads `GET path` (an answer of the form `{ data }`) when `path` changes, and loads it again on
 * `reload()`. A `null` path loads nothing.
 */
export function useLoaded<T>(path: string | null): { resource: Loaded<T>; reload: () => void } {
  // The client is rebuilt on every render; the effect must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [resource, setResource] = useState<Loaded<T>>({ kind: 'loading' })
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (path === null) return undefined
    let isCurrent = true
    setResource({ kind: 'loading' })
    void (async () => {
      try {
        const response = await clientRef.current.get<{ data: T }>(path)
        if (isCurrent) setResource({ kind: 'ready', data: response.data.data })
      } catch {
        // A refusal or no answer: the page offers to try again.
        if (isCurrent) setResource({ kind: 'error' })
      }
    })()
    return () => {
      isCurrent = false
    }
  }, [path, count])

  const reload = useCallback(() => setCount((value) => value + 1), [])
  return { resource, reload }
}
