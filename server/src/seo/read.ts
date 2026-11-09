import type { Core, UID } from '@strapi/strapi'
import {
  HERO_COMPONENT,
  HERO_MEDIA_FIELD,
  deriveMetaDescription,
  deriveMetaTitle,
  firstParagraphOf,
} from '../../../contract/seo'
import { SEO_ATTRIBUTE } from '../constants/seo'

type Attributes = Record<string, { type?: string; components?: string[] }>

/** A file of the media library, reduced to what the SEO checks read. */
export interface FileFacts {
  id: number
  mime: string | null
  width: number | null
  height: number | null
}

/** A page's draft, reduced to what the SEO derivations and checks read. */
export interface SeoDraft {
  title: string
  siteName: string
  /** The blocks of each dynamic zone, in order, with the media of each populated. */
  zones: Record<string, unknown[]>
  seo: { id?: number; metaTitle: string; metaDescription: string; image: FileFacts | null }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null)

/** The dynamic zones of a content type, by name. */
export function zonesOf(strapi: Core.Strapi, uid: UID.ContentType): string[] {
  return Object.entries(strapi.contentType(uid).attributes as Attributes)
    .filter(([, attribute]) => attribute.type === 'dynamiczone')
    .map(([name]) => name)
}

/** The `populate` that reads every zone of the type with the media of each block, the seo component with its image and the site's name. */
function populateOf(strapi: Core.Strapi, uid: UID.ContentType): Record<string, unknown> {
  const attributes = strapi.contentType(uid).attributes as Attributes
  const populate: Record<string, unknown> = {
    [SEO_ATTRIBUTE]: { populate: ['metaImage'] },
    site: { fields: ['name', 'slug'] },
  }
  for (const zone of zonesOf(strapi, uid)) {
    populate[zone] = {
      on: Object.fromEntries(
        (attributes[zone]?.components ?? []).map((component) => {
          const media = Object.entries(
            (strapi.components[component as UID.Component]?.attributes ?? {}) as Attributes
          )
            .filter(([, attribute]) => attribute.type === 'media')
            .map(([name]) => name)
          return [component, media.length > 0 ? { populate: media } : true]
        })
      ),
    }
  }
  return populate
}

function fileFacts(value: unknown): FileFacts | null {
  if (typeof value !== 'object' || value === null) return null
  const file = value as Record<string, unknown>
  if (typeof file.id !== 'number') return null
  return {
    id: file.id,
    mime: typeof file.mime === 'string' ? file.mime : null,
    width: num(file.width),
    height: num(file.height),
  }
}

/**
 * Reads a page's draft for the SEO derivations and checks, or `null` when there is none.
 *
 * @remarks
 * `siteName` is the site's name, or its slug when it has none.
 */
export async function readSeoDraft(
  strapi: Core.Strapi,
  target: { uid: UID.ContentType; documentId: string; locale?: string | null }
): Promise<SeoDraft | null> {
  const draft = (await strapi.documents(target.uid).findOne({
    documentId: target.documentId,
    locale: target.locale ?? undefined,
    status: 'draft',
    populate: populateOf(strapi, target.uid),
  } as never)) as Record<string, unknown> | null
  if (!draft) return null
  const site = draft.site as { name?: unknown; slug?: unknown } | null | undefined
  const seo = draft[SEO_ATTRIBUTE] as Record<string, unknown> | null | undefined
  return {
    title: text(draft.title),
    siteName: text(site?.name) || text(site?.slug),
    zones: Object.fromEntries(
      zonesOf(strapi, target.uid).map((zone) => [
        zone,
        Array.isArray(draft[zone]) ? (draft[zone] as unknown[]) : [],
      ])
    ),
    seo: {
      id: typeof seo?.id === 'number' ? seo.id : undefined,
      metaTitle: text(seo?.metaTitle),
      metaDescription: text(seo?.metaDescription),
      image: fileFacts(seo?.metaImage),
    },
  }
}

/** The file a hero block of `blocks` holds as its media, when it is an image; the media may be a populated file or a reference. */
export async function heroImageOf(
  strapi: Core.Strapi,
  blocks: readonly unknown[]
): Promise<FileFacts | null> {
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue
    const own = block as Record<string, unknown>
    if (own.__component !== HERO_COMPONENT) continue
    const file = await fileOf(strapi, own[HERO_MEDIA_FIELD])
    if (file?.mime?.startsWith('image/')) return file
  }
  return null
}

/** The file a media value names: a populated file, its id, or its `documentId`. */
export async function fileOf(strapi: Core.Strapi, value: unknown): Promise<FileFacts | null> {
  const direct = fileFacts(value)
  if (direct?.mime) return direct
  const where =
    typeof value === 'number'
      ? { id: value }
      : typeof value === 'string'
        ? { documentId: value }
        : direct
          ? { id: direct.id }
          : undefined
  if (!where) return null
  return fileFacts(await strapi.db.query('plugin::upload.file').findOne({ where }))
}

/** What the defaults of a page would be from its draft: the fields that are empty and what fills them. */
export async function derivedFor(
  strapi: Core.Strapi,
  draft: SeoDraft
): Promise<{ metaTitle?: string; metaDescription?: string; metaImage?: number }> {
  const derived: { metaTitle?: string; metaDescription?: string; metaImage?: number } = {}
  if (draft.seo.metaTitle.trim() === '') {
    const title = deriveMetaTitle(draft.title, draft.siteName)
    if (title !== '') derived.metaTitle = title
  }
  if (draft.seo.metaDescription.trim() === '') {
    const description = deriveMetaDescription(firstParagraphOf(Object.values(draft.zones).flat()))
    if (description !== '') derived.metaDescription = description
  }
  if (draft.seo.image === null) {
    const hero = await heroImageOf(strapi, Object.values(draft.zones).flat())
    if (hero) derived.metaImage = hero.id
  }
  return derived
}
