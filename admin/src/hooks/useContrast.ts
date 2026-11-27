import { useFetchClient } from '@strapi/strapi/admin'
import { useCallback, useEffect, useRef, useState } from 'react'

import { DEFAULT_MEASURED_TYPES } from '../../../server/src/constants/budget'
import type { FrameState } from '../components/PreviewFrame'
import { contrastRoute, parseContrastAnswer, type ContrastAnswer } from '../utils/customize'
import { usePreviewSource } from './usePreviewSource'

/** Why the contrast was not checked. */
export type ContrastUnchecked = 'forbidden' | 'noPage' | 'unavailable' | 'busy' | 'failed'

/** What the page knows of the contrast of the site's theme. */
export type ContrastState =
  | { kind: 'loading' }
  /** `key` names the candidates the answer is for (`candidatesKey`). */
  | { kind: 'ready'; answer: ContrastAnswer; key: string }
  | { kind: 'unchecked'; reason: ContrastUnchecked }

/** The page the grant is for, and the frame that gets it: what the page renders, hidden. */
export interface ContrastFrame {
  src: string
  origin: string
  documentId: string
  locale: string | null
}

/** How long the editor's typing must pause before the route is asked again, in milliseconds. */
const SETTLE_MS = 600

/** How long the frontend has to answer the contrast route, in milliseconds. */
const FETCH_TIMEOUT_MS = 15_000

/** One request's key for a list of candidates, in a stable order. */
export function candidatesKey(candidates: { mode: string; color: string }[]): string {
  return candidates.map(({ mode, color }) => `${mode}:${color.toLowerCase()}`).join(',')
}

type Target =
  | { kind: 'loading' }
  | { kind: 'found'; uid: string; documentId: string; locale: string | null }
  | { kind: 'none' }

/**
 * Asks the site's frontend for the contrast of its theme with the candidate accents
 * (`GET /_micelio/contrast`, `docs/api.md` of `micelio`), with the editor's own preview grant.
 *
 * @remarks
 * The grant is for one page of the site: the most recently updated entry of the site, of the first
 * type the frontend previews (`DEFAULT_MEASURED_TYPES`) that the editor may read in the Content
 * Manager. Its token comes from `POST /micelio/preview/token` as for the cost meter; the caller
 * renders `frame` in a frame that is never shown, which sets the grant's cookie, and reports the
 * frame's state with `onFrame`. The route is then asked with a credentialed `fetch`, again each time
 * the candidates stay the same for `SETTLE_MS` (ADR-0019 of `micelio`, amendment of 2026-11-25,
 * "Cost"). No grant or colour goes into the frame's URL or a message. With no page, no permission
 * or no answer the state is `unchecked`, with the reason.
 *
 * @param siteId - The site's document, or `undefined` while none is chosen.
 * @param candidates - The accents in the form that are `#RRGGBB`, one per mode.
 */
export function useContrast(
  siteId: string | undefined,
  candidates: { mode: string; color: string }[]
): {
  state: ContrastState
  frame: ContrastFrame | undefined
  onFrame: (state: FrameState) => void
  onBlocked: () => void
} {
  // The client is rebuilt on every render; the effects must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [target, setTarget] = useState<Target>({ kind: 'loading' })
  const [isFrameReady, setIsFrameReady] = useState(false)
  const [frameFailed, setFrameFailed] = useState(false)
  const [state, setState] = useState<ContrastState>({ kind: 'loading' })
  const key = candidatesKey(candidates)
  const [settledKey, setSettledKey] = useState(key)
  const candidatesRef = useRef(candidates)
  candidatesRef.current = candidates

  useEffect(() => {
    if (!siteId) return
    let isCurrent = true
    setTarget({ kind: 'loading' })
    setIsFrameReady(false)
    setFrameFailed(false)
    setState({ kind: 'loading' })
    void (async () => {
      for (const uid of DEFAULT_MEASURED_TYPES) {
        try {
          const answer = await clientRef.current.get<{
            results?: { documentId?: unknown; locale?: unknown }[]
          }>(`/content-manager/collection-types/${uid}`, {
            params: {
              page: 1,
              pageSize: 1,
              sort: 'updatedAt:DESC',
              filters: { $and: [{ site: { documentId: { $eq: siteId } } }] },
            },
          })
          const entry = answer.data.results?.[0]
          if (typeof entry?.documentId === 'string') {
            if (isCurrent) {
              setTarget({
                kind: 'found',
                uid,
                documentId: entry.documentId,
                locale: typeof entry.locale === 'string' ? entry.locale : null,
              })
            }
            return
          }
        } catch {
          // A type the host lacks, or one the editor may not read: the next one may have a page.
        }
      }
      if (isCurrent) setTarget({ kind: 'none' })
    })()
    return () => {
      isCurrent = false
    }
  }, [siteId])

  const { source } = usePreviewSource(target.kind === 'found' ? target : undefined, 'live')

  // The route is asked again once the candidates stop changing.
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledKey(key), SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [key])

  const url =
    target.kind === 'found' && source.kind === 'ready' && isFrameReady
      ? contrastRoute(source.src, target.documentId, candidatesRef.current)
      : undefined
  // The URL holds the candidates of the last settled key only.
  const settledUrl = settledKey === key ? url : undefined

  useEffect(() => {
    if (target.kind === 'none') setState({ kind: 'unchecked', reason: 'noPage' })
  }, [target.kind])

  useEffect(() => {
    if (source.kind !== 'error') return
    setState({
      kind: 'unchecked',
      reason:
        source.reason === 'forbidden'
          ? 'forbidden'
          : source.reason === 'busy'
            ? 'busy'
            : 'unavailable',
    })
  }, [source])

  useEffect(() => {
    if (frameFailed) setState({ kind: 'unchecked', reason: 'unavailable' })
  }, [frameFailed])

  useEffect(() => {
    if (!settledUrl) return
    let isCurrent = true
    const asked = settledKey
    setState((current) => (current.kind === 'ready' ? current : { kind: 'loading' }))
    void (async () => {
      try {
        const response = await fetch(settledUrl, {
          credentials: 'include',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!response.ok) {
          if (isCurrent) {
            setState({
              kind: 'unchecked',
              reason: response.status === 429 ? 'busy' : 'unavailable',
            })
          }
          return
        }
        const answer = parseContrastAnswer(await response.json())
        if (isCurrent) {
          setState(
            answer ? { kind: 'ready', answer, key: asked } : { kind: 'unchecked', reason: 'failed' }
          )
        }
      } catch {
        // The browser refused the request, the frontend did not answer in time, or not with JSON.
        if (isCurrent) setState({ kind: 'unchecked', reason: 'unavailable' })
      }
    })()
    return () => {
      isCurrent = false
    }
  }, [settledUrl, settledKey])

  const onFrame = useCallback((frame: FrameState) => {
    if (frame.protocol === 'ok') setIsFrameReady(true)
    if (frame.isSilent || frame.protocol === 'upgrade') setFrameFailed(true)
  }, [])
  const onBlocked = useCallback(() => setFrameFailed(true), [])

  const frame =
    target.kind === 'found' && source.kind === 'ready'
      ? {
          src: source.src,
          origin: source.origin,
          documentId: target.documentId,
          locale: target.locale,
        }
      : undefined
  return { state, frame, onFrame, onBlocked }
}
