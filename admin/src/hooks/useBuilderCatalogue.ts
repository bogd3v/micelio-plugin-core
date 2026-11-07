import { useFetchClient } from '@strapi/strapi/admin'
import { useEffect, useRef, useState } from 'react'

import type { ComponentSchema } from '../utils/builder/fields'
import type { CatalogueEntry } from '../utils/builder/palette'
import { statusOf } from '../utils/fetchError'
import { ZONE } from '../utils/builder/model'

/** What the builder needs to know about the page type and its site before it can compose. */
export interface BuilderCatalogue {
  /** The site's blocks, as the palette lists them. */
  entries: CatalogueEntry[]
  /** The components the zone accepts, by UID. */
  zoneComponents: string[]
  /** The schema of every component the zone accepts and of the items inside them. */
  schemas: Record<string, ComponentSchema>
}

/** What the page knows of the catalogue. */
export type CatalogueResource =
  | { kind: 'loading' }
  | { kind: 'ready'; catalogue: BuilderCatalogue }
  | { kind: 'error'; reason: 'forbidden' | 'noZone' | 'failed' }

interface ContentTypeAnswer {
  data: { uid: string; attributes: Record<string, { type?: string; components?: string[] }> }[]
}

interface ComponentsAnswer {
  data: { uid: string; attributes: ComponentSchema['attributes'] }[]
}

/**
 * Reads what the builder composes with: the site's merged catalogue
 * (`GET /micelio/blocks?site=`), the dynamic zone of the content type and the schemas of the
 * components in it (the Content Manager's own routes).
 *
 * @param uid - The page's content type; `undefined` for a template, which belongs to no content
 * type: every block of the site's catalogue is offered and there is no zone to read.
 * @param site - The slug of the page's site, or `undefined` while it is not known.
 */
export function useBuilderCatalogue(
  uid: string | undefined,
  site: string | undefined
): CatalogueResource {
  // The client is rebuilt on every render; the effect must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [resource, setResource] = useState<CatalogueResource>({ kind: 'loading' })

  useEffect(() => {
    if (!site) return
    let isCurrent = true
    void (async () => {
      try {
        const api = clientRef.current
        const [blocks, types, components] = await Promise.all([
          api.get<{ data: CatalogueEntry[] }>('/micelio/blocks', { params: { site } }),
          uid === undefined
            ? Promise.resolve(undefined)
            : api.get<ContentTypeAnswer>('/content-manager/content-types'),
          api.get<ComponentsAnswer>('/content-manager/components'),
        ])
        const attributes = types?.data.data.find((type) => type.uid === uid)?.attributes ?? {}
        // The preview protocol addresses the zone `sections` only (`blocks` is not spoken yet), and the
        // document hook reads and writes that attribute: another zone would show an empty page.
        if (uid !== undefined && attributes[ZONE]?.type !== 'dynamiczone') {
          if (isCurrent) setResource({ kind: 'error', reason: 'noZone' })
          return
        }
        const schemas = Object.fromEntries(
          components.data.data.map(({ uid: component, attributes: own }) => [
            component,
            { uid: component, attributes: own },
          ])
        )
        if (isCurrent) {
          setResource({
            kind: 'ready',
            catalogue: {
              entries: blocks.data.data,
              zoneComponents:
                uid === undefined
                  ? blocks.data.data.map((entry) => entry.component)
                  : (attributes[ZONE]?.components ?? []),
              schemas,
            },
          })
        }
      } catch (error) {
        if (isCurrent) {
          setResource({ kind: 'error', reason: statusOf(error) === 403 ? 'forbidden' : 'failed' })
        }
      }
    })()
    return () => {
      isCurrent = false
    }
  }, [uid, site])

  return resource
}
