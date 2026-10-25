import { useFetchClient } from '@strapi/strapi/admin'
import { useEffect, useRef, useState } from 'react'

import type { AdminPageGroup } from '../../../server/src/types/extensions'
import type { LocalisedText } from '../utils/localised'

/** A page of a sibling plugin the caller may see (`GET /micelio/admin-pages`). */
export interface AdminPageItem {
  id: string
  group: AdminPageGroup
  label: LocalisedText
  to: string
}

/** The pages of sibling plugins in the sub-navigation; empty while loading or when none. */
export function useAdminPages(): {
  pages: AdminPageItem[]
  hasFailed: boolean
  isLoading: boolean
} {
  // The client is rebuilt on every render; the effect must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [state, setState] = useState<{
    pages: AdminPageItem[]
    hasFailed: boolean
    isLoading: boolean
  }>({ pages: [], hasFailed: false, isLoading: true })

  useEffect(() => {
    let isCurrent = true
    void (async () => {
      try {
        const response = await clientRef.current.get<{ data: AdminPageItem[] }>(
          '/micelio/admin-pages'
        )
        if (isCurrent) setState({ pages: response.data.data, hasFailed: false, isLoading: false })
      } catch {
        // The core's own entries still work: the navigation says the others did not load.
        if (isCurrent) setState({ pages: [], hasFailed: true, isLoading: false })
      }
    })()
    return () => {
      isCurrent = false
    }
  }, [])

  return state
}
