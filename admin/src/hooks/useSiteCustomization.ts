import { useFetchClient } from '@strapi/strapi/admin'
import { useCallback, useEffect, useRef, useState } from 'react'

import { SITE_UID } from '../../../server/src/constants/site'
import { customizationOf, customizeBodyOf, type CustomizeValues } from '../utils/customize'
import { statusOf } from '../utils/fetchError'
import { refusalOf } from '../utils/sitesPage'

/** What the Customize page can be showing of a site in a locale. */
export type CustomizationState =
  | { kind: 'loading' }
  | { kind: 'ready'; values: CustomizeValues }
  /** `status` is the HTTP status of the read, when it had one (404: the site has no entry in that locale, whether the read answered 404 or an empty `data`). */
  | { kind: 'error'; status: number | undefined }

/** What a save came to: done, or what the server refused with (empty when it said nothing). */
export type CustomizationSaveOutcome = { ok: true } | { ok: false; refusal: string }

/**
 * Reads the entry of a site in a locale as the Content Manager's admin API answers it, and saves the
 * fields of the Customize page to the same entry through the same API.
 *
 * @remarks
 * The write is `PUT /content-manager/collection-types/plugin::micelio.site/:documentId?locale=`, as
 * `useSiteEntry` writes for the Sites page, so the rules of `server/src/sites/rules.ts` and the
 * caller's Content Manager permissions apply as they do in the edit view. The body holds only the
 * fields the page edits: `customizeBodyOf`, or the `bodyOf` a caller passes to `save` (the
 * customizer's `accentsBodyOf`). A save that succeeds reads the entry again, and the
 * state keeps the values read before until the new ones arrive. A locale the site has no version of
 * (the Content Manager answers it with an empty `data`) is the `error` state with status 404, so the
 * page offers no form and no save there.
 *
 * @param documentId - The site's document, or `undefined` while no site is chosen.
 * @param locale - The locale of the localised fields (`name`, `tagline`, `description`).
 */
export function useSiteCustomization(
  documentId: string | undefined,
  locale: string
): {
  state: CustomizationState
  save: (
    values: CustomizeValues,
    bodyOf?: (values: CustomizeValues) => Record<string, unknown>
  ) => Promise<CustomizationSaveOutcome>
} {
  // The client is rebuilt on every render; the effects must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [state, setState] = useState<CustomizationState>({ kind: 'loading' })
  const [count, setCount] = useState(0)
  // A read after a save keeps the form in view until the new answer arrives.
  const isQuietRef = useRef(false)
  const path = documentId ? `/content-manager/collection-types/${SITE_UID}/${documentId}` : null

  useEffect(() => {
    if (!path) return
    let isCurrent = true
    if (!isQuietRef.current) setState({ kind: 'loading' })
    isQuietRef.current = false
    void (async () => {
      try {
        const answer = await clientRef.current.get<{ data?: Record<string, unknown> }>(path, {
          params: { locale },
        })
        const data = answer.data.data ?? {}
        if (!isCurrent) return
        // A locale the site has no version of answers 200 with an empty `data`: there is no entry to
        // edit, and a save from that blank form would write the fields every locale shares.
        if (typeof data.documentId !== 'string') {
          setState({ kind: 'error', status: 404 })
          return
        }
        setState({ kind: 'ready', values: customizationOf(data) })
      } catch (error) {
        if (isCurrent) setState({ kind: 'error', status: statusOf(error) })
      }
    })()
    return () => {
      isCurrent = false
    }
  }, [path, locale, count])

  const save = useCallback(
    async (
      values: CustomizeValues,
      bodyOf: (values: CustomizeValues) => Record<string, unknown> = customizeBodyOf
    ): Promise<CustomizationSaveOutcome> => {
      if (!path) return { ok: false, refusal: '' }
      try {
        await clientRef.current.put(path, bodyOf(values), { params: { locale } })
        isQuietRef.current = true
        setCount((value) => value + 1)
        return { ok: true }
      } catch (error) {
        return { ok: false, refusal: refusalOf(error) }
      }
    },
    [path, locale]
  )

  return { state, save }
}
