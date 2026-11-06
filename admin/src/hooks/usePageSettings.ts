import { useFetchClient } from '@strapi/strapi/admin'
import { useCallback, useEffect, useRef, useState } from 'react'

import { statusOf } from '../utils/fetchError'
import type { PageTypeOption } from '../utils/builder/pageSettings'

/** A redirect of the page, as the Content Manager lists it. */
export interface PageRedirect {
  documentId: string
  from: string
  to: string
}

/** What the drawer's General tab knows around the page. */
export interface PageSettingsData {
  /** The page types the site offers with their budgets; empty while they load or when the read failed. */
  pageTypes: PageTypeOption[]
  /** The slug that is live, or `undefined` while the page was never published. */
  publishedSlug: string | undefined
  /** The redirects that lead to the live address; `undefined` while they load. */
  redirects: PageRedirect[] | undefined
  /** Whether the role may not read or remove redirects. */
  isRedirectsForbidden: boolean
  /** Deletes a redirect and lists them again; `false` when the server refused. */
  removeRedirect: (documentId: string) => Promise<boolean>
}

const CM = '/content-manager/collection-types'

/** The UID of the redirect content type; the admin takes nothing but types from the server. */
const REDIRECT_UID = 'plugin::micelio.redirect'

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

/**
 * Reads what the General tab shows beside the page's own fields, while the drawer is `isOpen`:
 * the site's page types with their budgets (`GET /micelio/budget/page-types`), the live slug, and the
 * redirects that lead to it (the Content Manager's route for `plugin::micelio.redirect`).
 *
 * @remarks
 * `refresh()` reads the live slug and the redirects again, which the page does after a republish.
 */
export function usePageSettings(args: {
  isOpen: boolean
  uid: string
  documentId: string
  locale: string | null
  site: string | undefined
  /** The page's draft version: a save may have published or renamed the page. */
  version: string | undefined
}): PageSettingsData {
  const { isOpen, uid, documentId, locale, site, version } = args
  // The client is rebuilt on every render; the effects must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [pageTypes, setPageTypes] = useState<PageTypeOption[]>([])
  const [publishedSlug, setPublishedSlug] = useState<string>()
  const [redirects, setRedirects] = useState<PageRedirect[]>()
  const [isRedirectsForbidden, setIsRedirectsForbidden] = useState(false)
  const [reads, setReads] = useState(0)

  useEffect(() => {
    if (!isOpen || !site) return
    let isCurrent = true
    void (async () => {
      try {
        const answer = await clientRef.current.get<{ data: PageTypeOption[] }>(
          '/micelio/budget/page-types',
          { params: { site } }
        )
        if (isCurrent) setPageTypes(answer.data.data)
      } catch {
        // No list: the drawer shows the page's own type only.
        if (isCurrent) setPageTypes([])
      }
    })()
    return () => {
      isCurrent = false
    }
  }, [isOpen, site])

  useEffect(() => {
    if (!isOpen || !site) return
    let isCurrent = true
    void (async () => {
      let live: string | undefined
      try {
        const answer = await clientRef.current.get<{ data: { slug?: unknown } }>(
          `${CM}/${uid}/${documentId}`,
          { params: { ...(locale ? { locale } : {}), status: 'published' } }
        )
        live = text(answer.data.data?.slug)
      } catch {
        // Never published (or not readable): there is no live address to redirect from.
      }
      if (!isCurrent) return
      setPublishedSlug(live)
      if (!live) {
        setRedirects([])
        return
      }
      const query = new URLSearchParams({
        'filters[site][slug][$eq]': site,
        'filters[to][$eq]': `/${live}`,
        pageSize: '100',
      })
      if (locale) query.set('filters[entryLocale][$eq]', locale)
      try {
        const answer = await clientRef.current.get<{ results: PageRedirect[] }>(
          `${CM}/${REDIRECT_UID}?${query}`
        )
        if (!isCurrent) return
        setIsRedirectsForbidden(false)
        setRedirects(
          answer.data.results.map(({ documentId: id, from, to }) => ({ documentId: id, from, to }))
        )
      } catch (error) {
        if (!isCurrent) return
        setIsRedirectsForbidden(statusOf(error) === 403)
        setRedirects([])
      }
    })()
    return () => {
      isCurrent = false
    }
  }, [isOpen, uid, documentId, locale, site, version, reads])

  const removeRedirect = useCallback(async (redirectId: string): Promise<boolean> => {
    try {
      await clientRef.current.del(`${CM}/${REDIRECT_UID}/${redirectId}`)
      setReads((count) => count + 1)
      return true
    } catch {
      return false
    }
  }, [])

  return { pageTypes, publishedSlug, redirects, isRedirectsForbidden, removeRedirect }
}
