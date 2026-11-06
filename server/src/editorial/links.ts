import type { Core, UID } from '@strapi/strapi'
import { populateOf } from '../block-settings/populate'
import { SLUG_ATTRIBUTE } from '../constants/page-settings'
import { hasPageSettings } from '../page-settings'
import { blockOfComponent, type AttributesOf } from '../page-templates/rules'
import { isSiteScoped, SITE_ATTRIBUTE } from '../site-scope'

/** A link of a block to an address of the site itself, such as `/pricing`. */
export interface InternalLink {
  /** The `id` of the block in the catalogue, or its component when it is not one. */
  block: string
  /** Its place in the zone, from 0. */
  position: number
  /** The field of the block that holds the link, such as `primaryLink` or `items[1].link`. */
  field: string
  /** The address, without its query or fragment: `/pricing`. */
  path: string
}

/** A link of a block to a page of the same site that has no published version. */
export interface LinkToDraft extends InternalLink {
  /** The dynamic zone that holds the block. */
  zone: string
  /** The page the link points to. */
  page: { uid: string; documentId: string; title: string }
}

type Row = Record<string, unknown>

const isRecord = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The address of a link to the site itself, or `undefined` for one that leaves it or names no page. */
function internalPath(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return undefined
  const path = url.split(/[?#]/)[0]!.replace(/\/+$/, '')
  return path === '' ? undefined : path
}

function linksIn(
  attributesOf: AttributesOf,
  component: string,
  row: Row,
  prefix: string
): Omit<InternalLink, 'block' | 'position'>[] {
  return Object.entries(attributesOf(component) ?? {}).flatMap(([name, attribute]) => {
    if (attribute.type !== 'component' || !attribute.component) return []
    const value = row[name]
    const items = attribute.repeatable ? (Array.isArray(value) ? value : []) : [value]
    return items.flatMap((item, index) => {
      if (!isRecord(item)) return []
      const field = attribute.repeatable ? `${prefix}${name}[${index}]` : `${prefix}${name}`
      if (attribute.component!.endsWith('.link')) {
        const path = internalPath(item.url)
        return path ? [{ field, path }] : []
      }
      return linksIn(attributesOf, attribute.component!, item, `${field}.`)
    })
  })
}

/**
 * The links of a dynamic zone's blocks to addresses of the site itself.
 *
 * @remarks
 * A link is a part whose component ends in `.link` (`section.link` in `contract/blocks.ts`), found
 * however deep in the block; its `url` counts when it is a path (`/pricing`), not a full address or
 * `mailto:`. Pure: the zone is read as the document service answers it, with its components populated.
 *
 * @param zone - The zone's components, each with its `__component`.
 */
export function findInternalLinks(
  attributesOf: AttributesOf,
  zone: readonly unknown[]
): InternalLink[] {
  return zone.flatMap((content, position) => {
    if (!isRecord(content) || typeof content.__component !== 'string') return []
    const block = blockOfComponent(content.__component)?.id ?? content.__component
    return linksIn(attributesOf, content.__component, content, '').map((link) => ({
      block,
      position,
      ...link,
    }))
  })
}

/**
 * The links of an entry's draft to pages of its site that have no published version: the address
 * answers 404 until that page is published (`linkToDraft`, a warning of the transitions).
 *
 * @remarks
 * A link points to a page when its path is `/<slug>` of a draft of a page type (a type made with
 * `withPageSettings`) of the same site and locale. A link to a page that does not exist at all, or to
 * the entry itself, is not reported. A type with no dynamic zone, or an entry with no site, is not read.
 */
export async function findLinksToDraftsIn(
  strapi: Core.Strapi,
  target: { uid: UID.ContentType; documentId: string; locale?: string | null; site: string | null }
): Promise<LinkToDraft[]> {
  if (!target.site) return []
  const model = strapi.contentType(target.uid)
  const zones = Object.entries(model.attributes as Record<string, { type?: string }>)
    .filter(([, attribute]) => attribute.type === 'dynamiczone')
    .map(([name]) => name)
  if (zones.length === 0) return []
  const attributesOf: AttributesOf = (uid) =>
    strapi.components[uid as UID.Component]?.attributes as ReturnType<AttributesOf>
  const locale = target.locale ?? undefined
  const draft = (await strapi.documents(target.uid).findOne({
    documentId: target.documentId,
    locale,
    status: 'draft',
    populate: populateOf(
      model.attributes,
      (component) => attributesOf(component) as Record<string, unknown> | undefined
    ),
  } as never)) as Row | null
  const links = zones.flatMap((zone) => {
    const value = draft?.[zone]
    return Array.isArray(value)
      ? findInternalLinks(attributesOf, value).map((link) => ({ ...link, zone }))
      : []
  })
  if (links.length === 0) return []

  const pageTypes = (Object.keys(strapi.contentTypes) as UID.ContentType[]).filter((uid) => {
    const schema = strapi.contentType(uid)
    return hasPageSettings(schema) && isSiteScoped(schema)
  })
  const found: LinkToDraft[] = []
  for (const link of links) {
    const page = await draftPageAt(strapi, pageTypes, link.path.slice(1), target.site, locale)
    if (page && page.documentId !== target.documentId) found.push({ ...link, page })
  }
  return found
}

/** The page of the site at `/<slug>` when it has no published version, else `undefined`. */
async function draftPageAt(
  strapi: Core.Strapi,
  pageTypes: UID.ContentType[],
  slug: string,
  site: string,
  locale: string | undefined
): Promise<LinkToDraft['page'] | undefined> {
  for (const uid of pageTypes) {
    const documents = strapi.documents(uid)
    const draft = (await documents.findFirst({
      locale,
      status: 'draft',
      filters: { [SLUG_ATTRIBUTE]: slug, [SITE_ATTRIBUTE]: { documentId: site } },
    } as never)) as Row | null
    if (!draft || typeof draft.documentId !== 'string') continue
    const live = await documents.findOne({
      documentId: draft.documentId,
      locale,
      status: 'published',
    } as never)
    if (live) return undefined
    const title = typeof draft.title === 'string' && draft.title !== '' ? draft.title : slug
    return { uid, documentId: draft.documentId, title }
  }
  return undefined
}
