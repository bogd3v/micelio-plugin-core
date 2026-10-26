import { useFetchClient } from '@strapi/strapi/admin'
import { useEffect, useRef, useState } from 'react'

import { statusOf } from '../utils/fetchError'
import { SAVE_POLL_MS } from '../utils/previewPane'

/** The entry the preview shows, as the Content Manager API answers it. */
export interface Entry {
  title: string
  /** `null` for a type that is not localised. */
  locale: string | null
  /** The locales the entry has a version in. */
  locales: string[]
  /** When the draft was last saved, as an ISO 8601 date. */
  updatedAt: string
}

/** What the page knows of the entry. */
export type EntryResource =
  | { kind: 'loading' }
  | { kind: 'ready'; entry: Entry }
  | { kind: 'error'; status: number | undefined }

interface CmAnswer {
  data: Record<string, unknown>
  meta?: { availableLocales?: { locale?: unknown }[] }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function toEntry(answer: CmAnswer, documentId: string): Entry {
  const locale = text(answer.data.locale) ?? null
  const others = (answer.meta?.availableLocales ?? []).flatMap(
    ({ locale: other }) => text(other) ?? []
  )
  return {
    title:
      text(answer.data.title) ?? text(answer.data.name) ?? text(answer.data.slug) ?? documentId,
    locale,
    locales: locale === null ? [] : [...new Set([locale, ...others])],
    updatedAt: text(answer.data.updatedAt) ?? '',
  }
}

/**
 * Reads the entry from the Content Manager's API and reads it again every few seconds while the
 * page is in view, and when it comes back into view, to notice a save made in the form.
 *
 * @returns The entry, and `savedCount`, which goes up by one each time the draft's `updatedAt`
 * changes after the first read. A change of locale starts counting again.
 */
export function useEntry(
  uid: string,
  documentId: string,
  locale: string | null
): { resource: EntryResource; savedCount: number } {
  // The client is rebuilt on every render; the effect must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [resource, setResource] = useState<EntryResource>({ kind: 'loading' })
  // The count belongs to the entry and locale it was counted for: after a switch the old one reads 0
  // at once, not after the effect below has reset it.
  const scope = `${uid}/${documentId}/${locale ?? ''}`
  const [saves, setSaves] = useState({ scope, count: 0 })

  useEffect(() => {
    let isCurrent = true
    let isReading = false
    let lastSeen: string | undefined
    async function read(isFirst: boolean): Promise<void> {
      if (isReading) return
      isReading = true
      try {
        const response = await clientRef.current.get<CmAnswer>(
          `/content-manager/collection-types/${uid}/${documentId}`,
          { params: locale ? { locale } : {} }
        )
        if (!isCurrent) return
        const entry = toEntry(response.data, documentId)
        if (lastSeen !== undefined && entry.updatedAt !== lastSeen) {
          setSaves((current) => ({ scope, count: current.scope === scope ? current.count + 1 : 1 }))
        }
        lastSeen = entry.updatedAt
        setResource({ kind: 'ready', entry })
      } catch (error) {
        // A failed poll keeps what the page shows; only the first read has nothing to keep.
        if (isCurrent && isFirst) setResource({ kind: 'error', status: statusOf(error) })
      } finally {
        isReading = false
      }
    }
    setResource({ kind: 'loading' })
    setSaves({ scope, count: 0 })
    void read(true)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void read(false)
    }, SAVE_POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void read(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      isCurrent = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [uid, documentId, locale])

  return { resource, savedCount: saves.scope === scope ? saves.count : 0 }
}
