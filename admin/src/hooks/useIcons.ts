import { useFetchClient } from '@strapi/strapi/admin'
import { useEffect, useRef, useState } from 'react'

import { type IconAnswerEntry, type IconsAnswer } from '../utils/icons'

/** What the picker asks the catalogue. */
export interface IconsRequest {
  site?: string
  q: string
  category: string | undefined
  locale: 'en' | 'es'
  /** How many entries to ask for, from the first. */
  limit: number
}

/** What the page knows of the catalogue. */
export type IconsResource =
  | { kind: 'loading'; previous?: IconsAnswer }
  | { kind: 'ready'; answer: IconsAnswer }
  | { kind: 'error' }

/**
 * Reads `GET /micelio/icons` for a query, again when it changes, and keeps the last answer while
 * the next one loads so the grid does not blink.
 *
 * @param isActive - `false` reads nothing (the picker is closed).
 */
export function useIcons(request: IconsRequest, isActive: boolean): IconsResource {
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [resource, setResource] = useState<IconsResource>({ kind: 'loading' })
  const { site, q, category, locale, limit } = request

  useEffect(() => {
    if (!isActive) return
    let isCurrent = true
    setResource((now) => ({
      kind: 'loading',
      previous:
        now.kind === 'ready' ? now.answer : now.kind === 'loading' ? now.previous : undefined,
    }))
    const load = async () => {
      try {
        const { data } = await clientRef.current.get<{ data: IconsAnswer }>('/micelio/icons', {
          params: { site, q: q || undefined, category, locale, limit },
        })
        if (isCurrent) setResource({ kind: 'ready', answer: data.data })
      } catch {
        if (isCurrent) setResource({ kind: 'error' })
      }
    }
    // A pause between keystrokes: the first read of an opening is at once.
    const timer = setTimeout(() => void load(), q ? 180 : 0)
    return () => {
      isCurrent = false
      clearTimeout(timer)
    }
  }, [isActive, site, q, category, locale, limit])

  return resource
}

const known = new Map<string, Promise<IconAnswerEntry | undefined>>()

/**
 * Asks for one name; a failure is no entry (the field shows the stored name alone) and is not
 * kept in `known`, so the next mount asks again.
 */
async function fetchEntry(
  client: ReturnType<typeof useFetchClient>,
  key: string,
  params: { site: string | undefined; name: string; locale: 'en' | 'es' }
): Promise<IconAnswerEntry | undefined> {
  try {
    const { data } = await client.get<{ data: IconsAnswer }>('/micelio/icons', { params })
    return data.data.entries[0]
  } catch {
    known.delete(key)
    return undefined
  }
}

/**
 * The entry of a stored name (an alias answers the glyph it points to): what the field shows
 * under the name. `undefined` while it loads and for a name the catalogue does not have.
 */
export function useIconEntry(
  name: string | null,
  site: string | undefined,
  locale: 'en' | 'es'
): IconAnswerEntry | undefined {
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [entry, setEntry] = useState<{ name: string; entry: IconAnswerEntry | undefined }>()

  useEffect(() => {
    if (!name) return
    let isCurrent = true
    const key = `${site ?? ''}|${locale}|${name}`
    let request = known.get(key)
    if (!request) {
      request = fetchEntry(clientRef.current, key, { site, name, locale })
      known.set(key, request)
    }
    void (async () => {
      const found = await request
      if (isCurrent) setEntry({ name, entry: found })
    })()
    return () => {
      isCurrent = false
    }
  }, [name, site, locale])

  return name && entry?.name === name ? entry.entry : undefined
}
