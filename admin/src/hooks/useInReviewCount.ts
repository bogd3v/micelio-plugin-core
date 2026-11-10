import { useFetchClient } from '@strapi/strapi/admin'
import { useEffect, useRef, useState } from 'react'

import type { InReviewSite } from '../../../server/src/types/editorial'
import { countInReview } from '../navigation'

/**
 * The number of pages awaiting review, for the sub-navigation (`GET /micelio/review`, summed over
 * its sites): `null` while the first answer loads, when the request fails and when `enabled` is
 * false; `0` when none waits.
 *
 * @param enabled - Whether the caller holds the review permission: otherwise nothing is requested.
 * @param refreshKey - One request is made when it changes (the path the editor is on), never on a
 * timer. The previous number stays until the new answer arrives.
 */
export function useInReviewCount(enabled: boolean, refreshKey: string): number | null {
  // The client is rebuilt on every render; the effect must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setCount(null)
      return undefined
    }
    let isCurrent = true
    void (async () => {
      try {
        const response = await clientRef.current.get<{ data: InReviewSite[] }>('/micelio/review')
        if (isCurrent) setCount(countInReview(response.data.data))
      } catch {
        if (isCurrent) setCount(null)
      }
    })()
    return () => {
      isCurrent = false
    }
  }, [enabled, refreshKey])

  return count
}
