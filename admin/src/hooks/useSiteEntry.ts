import { useFetchClient } from '@strapi/strapi/admin'
import { useCallback, useEffect, useRef, useState } from 'react'

import { SITE_UID } from '../../../server/src/constants/site'
import { statusOf } from '../utils/fetchError'
import { formValuesOf, refusalOf, saveBodyOf, type SiteFormValues } from '../utils/sitesPage'

/** What the form of a site can be showing. */
export type SiteEntryState =
  | { kind: 'loading' }
  | { kind: 'ready'; values: SiteFormValues }
  /** `status` is the HTTP status of the read, when it had one (404: the site has no entry in the default locale). */
  | { kind: 'error'; status: number | undefined }

/** What a save came to: the new values, or what the server refused with. */
export type SiteSaveOutcome = { ok: true } | { ok: false; refusal: string }

/**
 * Reads the entry of a site as the Content Manager's admin API answers it, in Strapi's default
 * locale (`GET /i18n/locales`, the locale with `isDefault`), and saves the five fields of the
 * form to the same entry through the same API.
 *
 * @remarks
 * The write is `PUT /content-manager/collection-types/plugin::micelio.site/:documentId`, so the
 * rules of `server/src/sites/rules.ts` and the caller's Content Manager permissions apply as they
 * do in the edit view. It sends only the five fields. A role that cannot read the locales reads
 * the entry with no `locale`, which is the default locale too.
 */
export function useSiteEntry(documentId: string): {
  state: SiteEntryState
  save: (values: SiteFormValues) => Promise<SiteSaveOutcome>
} {
  // The client is rebuilt on every render; the effects must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const localeRef = useRef<Promise<string | undefined>>()
  const [state, setState] = useState<SiteEntryState>({ kind: 'loading' })
  const path = `/content-manager/collection-types/${SITE_UID}/${documentId}`

  const defaultLocale = useCallback((): Promise<string | undefined> => {
    localeRef.current ??= (async () => {
      try {
        const answer =
          await clientRef.current.get<{ code?: unknown; isDefault?: unknown }[]>('/i18n/locales')
        const found = Array.isArray(answer.data)
          ? answer.data.find((locale) => locale.isDefault === true)
          : undefined
        return typeof found?.code === 'string' ? found.code : undefined
      } catch {
        // A role that may not list the locales: the entry is read in the default one anyway.
        return undefined
      }
    })()
    return localeRef.current
  }, [])

  useEffect(() => {
    let isCurrent = true
    setState({ kind: 'loading' })
    void (async () => {
      try {
        const locale = await defaultLocale()
        const answer = await clientRef.current.get<{ data?: Record<string, unknown> }>(path, {
          params: locale ? { locale } : {},
        })
        if (isCurrent) setState({ kind: 'ready', values: formValuesOf(answer.data.data ?? {}) })
      } catch (error) {
        if (isCurrent) setState({ kind: 'error', status: statusOf(error) })
      }
    })()
    return () => {
      isCurrent = false
    }
  }, [path, defaultLocale])

  const save = useCallback(
    async (values: SiteFormValues): Promise<SiteSaveOutcome> => {
      try {
        const locale = await defaultLocale()
        await clientRef.current.put(path, saveBodyOf(values), {
          params: locale ? { locale } : {},
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, refusal: refusalOf(error) }
      }
    },
    [path, defaultLocale]
  )

  return { state, save }
}
