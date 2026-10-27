import { useFetchClient } from '@strapi/strapi/admin'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { PreviewTokenAnswer } from '../../../server/src/types/preview'
import { statusOf } from '../utils/fetchError'
import {
  GRANT_REFRESH_MINUTES,
  frameTarget,
  openInNewTab,
  type PreviewMode,
} from '../utils/previewPane'

/** Why there is no URL to load. */
export type PreviewSourceError =
  'unavailable' | 'forbidden' | 'missing' | 'unsupported' | 'busy' | 'failed' | 'popup'

/** The URL of the iframe, or why there is none. */
export type PreviewSource =
  | { kind: 'loading' }
  | { kind: 'ready'; src: string; origin: string }
  | { kind: 'error'; reason: PreviewSourceError }

const REASONS: Record<number, PreviewSourceError> = {
  400: 'unsupported',
  403: 'forbidden',
  404: 'missing',
  409: 'unavailable',
  429: 'busy',
}

// The site's `url` is not one a page can load.
class NoTargetError extends Error {}

// Every refusal has a text of its own; anything else is a failure the editor can try again.
function reasonOf(error: unknown): PreviewSourceError {
  if (error instanceof NoTargetError) return 'unavailable'
  const status = statusOf(error)
  return (status && REASONS[status]) || 'failed'
}

interface PreviewEntry {
  uid: string
  documentId: string
  locale: string | null
}

type FetchClient = ReturnType<typeof useFetchClient>

/** Asks the token route for the URL of a preview; `undefined` when the site's `url` is not one a page can load. */
async function askForTarget(client: FetchClient, entry: PreviewEntry, mode: PreviewMode) {
  const response = await client.post<{ data: PreviewTokenAnswer }>('/micelio/preview/token', entry)
  return frameTarget(response.data.data.url, mode)
}

/**
 * Asks `POST /micelio/preview/token` for the URL of the iframe (ADR-0019, section 3), and again when
 * `reload()` is called, when the entry, locale or mode change, and before the grant expires.
 *
 * @remarks
 * The token is single-use and 60 seconds old at most, so it is requested only when a frame is about
 * to load. The previous source stays in `source` while the next one is requested, so the old render
 * stays in view.
 */
export function usePreviewSource(
  entry: PreviewEntry | undefined,
  mode: PreviewMode
): { source: PreviewSource; reload: () => void } {
  // The client is rebuilt on every render; the effect must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [source, setSource] = useState<PreviewSource>({ kind: 'loading' })
  const [count, setCount] = useState(0)
  const uid = entry?.uid
  const documentId = entry?.documentId
  const locale = entry?.locale

  useEffect(() => {
    if (!uid || !documentId) return
    let isCurrent = true
    let timer: number | undefined
    void (async () => {
      try {
        const target = await askForTarget(
          clientRef.current,
          { uid, documentId, locale: locale ?? null },
          mode
        )
        if (!isCurrent) return
        if (!target) {
          setSource({ kind: 'error', reason: 'unavailable' })
          return
        }
        setSource({ kind: 'ready', ...target })
        // The grant lasts 15 minutes from the exchange: ask for a new token before it ends.
        timer = window.setTimeout(
          () => setCount((value) => value + 1),
          GRANT_REFRESH_MINUTES * 60_000
        )
      } catch (error) {
        if (isCurrent) setSource({ kind: 'error', reason: reasonOf(error) })
      }
    })()
    return () => {
      isCurrent = false
      window.clearTimeout(timer)
    }
  }, [uid, documentId, locale, mode, count])

  const reload = useCallback(() => setCount((value) => value + 1), [])
  return { source, reload }
}

/**
 * Opens the preview of an entry in a new tab: a window in the click, sent to the URL of a token of its
 * own (ADR-0019, amendment of 2026-10-26), for a browser that does not send the frame its cookie.
 *
 * @remarks
 * The token goes only in that window's location. A refusal of the token route closes the window and
 * shows the pane's text for it; a browser that blocks the window shows `popup`.
 */
export function useNewTab(
  entry: PreviewEntry | undefined,
  mode: PreviewMode
): { open: () => Promise<void>; error: PreviewSourceError | undefined } {
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [error, setError] = useState<PreviewSourceError>()
  const uid = entry?.uid
  const documentId = entry?.documentId
  const locale = entry?.locale ?? null

  // An error belongs to the entry, locale and mode it came from.
  useEffect(() => {
    setError(undefined)
  }, [uid, documentId, locale, mode])

  const open = useCallback(async () => {
    if (!uid || !documentId) return
    setError(undefined)
    try {
      const isOpened = await openInNewTab(
        () => window.open('about:blank', '_blank'),
        async () => {
          const target = await askForTarget(clientRef.current, { uid, documentId, locale }, mode)
          if (!target) throw new NoTargetError('The site has no URL a page can load.')
          return target.src
        }
      )
      if (!isOpened) setError('popup')
    } catch (failure) {
      setError(reasonOf(failure))
    }
  }, [uid, documentId, locale, mode])

  return { open, error }
}
