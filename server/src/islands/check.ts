import type { Core, UID } from '@strapi/strapi'
import { BLOCKS } from '../../../contract/blocks'
import { findMissingAlternatives, type MissingAlternative } from './rules'

type Attributes = Record<string, { type?: string; components?: string[] }>

/** The media fields of a component among those its island's alternative lists. */
function mediaFieldsOf(
  strapi: Core.Strapi,
  component: string,
  wanted: readonly string[]
): string[] {
  const attributes = (strapi.components[component as UID.Component]?.attributes ?? {}) as Attributes
  return wanted.filter((name) => attributes[name]?.type === 'media')
}

/**
 * The blocks of an entry's draft whose island's static alternative is not filled in.
 *
 * @remarks
 * Reads every dynamic zone of the type, with the media of the island blocks populated (a poster is
 * a file, not text). A type whose zones accept no island block is not read at all.
 */
export async function findMissingAlternativesIn(
  strapi: Core.Strapi,
  target: { uid: UID.ContentType; documentId: string; locale?: string | null }
): Promise<(MissingAlternative & { zone: string })[]> {
  const islandsIn = (components: string[] = []) =>
    BLOCKS.filter((block) => block.cost.island && components.includes(block.schema.component))
  const zones = Object.entries(strapi.contentType(target.uid).attributes as Attributes).filter(
    ([, attribute]) =>
      attribute.type === 'dynamiczone' && islandsIn(attribute.components).length > 0
  )
  if (zones.length === 0) return []
  const populate = Object.fromEntries(
    zones.map(([name, attribute]) => [
      name,
      {
        on: Object.fromEntries(
          islandsIn(attribute.components).map((block) => {
            const media = mediaFieldsOf(
              strapi,
              block.schema.component,
              block.cost.island?.alternative ?? []
            )
            return [block.schema.component, media.length > 0 ? { populate: media } : true]
          })
        ),
      },
    ])
  )
  const draft = (await strapi.documents(target.uid).findOne({
    documentId: target.documentId,
    locale: target.locale ?? undefined,
    status: 'draft',
    populate,
  } as never)) as Record<string, unknown> | null
  return zones.flatMap(([name]) => {
    const zone = draft?.[name]
    return Array.isArray(zone)
      ? findMissingAlternatives(zone).map((missing) => ({ ...missing, zone: name }))
      : []
  })
}
