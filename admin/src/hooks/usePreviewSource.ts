import { useFetchClient } from '@strapi/strapi/admin'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { PreviewTokenAnswer } from '../../../server/src/types/preview'
import { statusOf } from '../utils/fetchError'
import { GRANT_REFRESH_MINUTES, frameTarget, type PreviewMode } from '../utils/previewPane'

/** Why there is no URL to load. */
export type PreviewSourceError =
  'unavailable' | 'forbidden' | 'missing' | 'unsupported' | 'busy' | 'failed'

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
  entry: { uid: string; documentId: string; locale: string | null } | undefined,
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
        const response = await clientRef.current.post<{ data: PreviewTokenAnswer }>(
          '/micelio/preview/token',
          { uid, documentId, locale }
        )
        const target = frameTarget(response.data.data.url, mode)
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
        // Every refusal has a text of its own; anything else is a failure the editor can try again.
        const status = statusOf(error)
        if (isCurrent) setSource({ kind: 'error', reason: (status && REASONS[status]) || 'failed' })
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
