import { useFetchClient } from '@strapi/strapi/admin'
import { useEffect, useRef, useState } from 'react'

import { isZone } from '../utils/review'

const SITE_UID = 'plugin::micelio.site'

/** The time zone of a document's site: what the schedule dialog and the scheduled date read. */
export interface SiteTimeZone {
  /**
   * The site's IANA time zone, or `undefined` when the site has none, the zone is not one the
   * browser knows, or the role may not read the site.
   */
  zone: string | undefined
  /** Whether the answer is still on its way: a dialog opened now would use the wrong zone. */
  isLoading: boolean
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

/**
 * The `timezone` of the site a document belongs to, read the way the builder reads the site
 * (`readSite`, `useBuilderDocument`): the relations route of the Content Manager, then, when its
 * answer does not carry the field, the site's own Content Manager entry.
 *
 * @remarks
 * It never widens a permission: a role that may not read the site gets `undefined`, and the
 * callers fall back to the browser's zone and say so. Both the builder's toolbar and the editorial
 * panel of the edit view use it, so a page is scheduled in the same zone from either.
 */
export function useSiteTimeZone(page: {
  uid: string
  documentId: string
  locale: string | null
}): SiteTimeZone {
  // The client is rebuilt on every render; the effect must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [state, setState] = useState<SiteTimeZone>({ zone: undefined, isLoading: true })
  const { uid, documentId, locale } = page

  useEffect(() => {
    let isCurrent = true
    setState({ zone: undefined, isLoading: true })
    void (async () => {
      let zone: string | undefined
      try {
        const api = clientRef.current
        const params = locale ? { locale } : {}
        const related = await api.get<{
          results?: { documentId?: unknown; timezone?: unknown; locale?: unknown }[]
        }>(`/content-manager/relations/${uid}/${documentId}/site`, { params })
        const found = related.data.results?.[0]
        zone = text(found?.timezone)
        const siteId = text(found?.documentId)
        if (!zone && siteId) {
          const siteLocale = text(found?.locale)
          const site = await api.get<{ data?: { timezone?: unknown } }>(
            `/content-manager/collection-types/${SITE_UID}/${siteId}`,
            { params: siteLocale ? { locale: siteLocale } : {} }
          )
          zone = text(site.data.data?.timezone)
        }
      } catch {
        // A role that may not read the site: the browser's zone, said so.
        zone = undefined
      }
      if (isCurrent) setState({ zone: zone && isZone(zone) ? zone : undefined, isLoading: false })
    })()
    return () => {
      isCurrent = false
    }
  }, [uid, documentId, locale])

  return state
}
