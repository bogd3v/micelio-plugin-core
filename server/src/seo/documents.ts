import { errors } from '@strapi/utils'
import type { Core, Modules, UID } from '@strapi/strapi'
import { structuredDataProblem } from '../../../contract/seo'
import { SEO_ATTRIBUTE, SEO_COMPONENT_UID, STRUCTURED_DATA_INVALID } from '../constants/seo'
import { SITE_UID } from '../constants/site'
import { hasPageSettings } from '../page-settings'
import { derivedFor, fileOf, readSeoDraft, zonesOf, type SeoDraft } from './read'
import { hasSeo } from '.'

type Params = Record<string, unknown> & { data?: Record<string, unknown>; documentId?: string }

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The `documentId` a relation value of a write names: the id, `{ documentId }` or the first of `connect`. */
function documentIdOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return undefined
  const own = value as { documentId?: unknown; connect?: unknown }
  if (typeof own.documentId === 'string') return own.documentId
  return Array.isArray(own.connect) ? documentIdOf(own.connect[0]) : undefined
}

/** Whether the host's `shared.seo` requires `metaDescription`, so a component without one is refused when the page is published. */
function requiresDescription(strapi: Core.Strapi): boolean {
  const component = strapi.components[SEO_COMPONENT_UID as UID.Component]
  const attributes = component?.attributes as Record<string, { required?: boolean }> | undefined
  return attributes?.metaDescription?.required === true
}

/**
 * The document service middleware of the SEO fields: it fills the empty meta title, meta description
 * and social image of a page from the page itself, and refuses hand-written structured data that is
 * not valid JSON-LD.
 *
 * @remarks
 * It acts on `create` and `update` of a page type made with `withPageSettings` that has a `seo`
 * component, and only when the data names the title, the `seo` component or a dynamic zone: a
 * transition, which writes `editorial` alone, derives nothing. The meta title is the page's title
 * and its site's name, the meta description the first paragraph of its text and the social image the
 * media of its first hero block (`contract/seo.ts`). A field that has a value is never touched, so
 * an edit overrides the default; a field the editor empties is derived again at the next save.
 * The existing `seo` component is updated in place (its `id` is added to the data), so the fields
 * the write does not name keep their values.
 *
 * When the host's `shared.seo` requires `metaDescription`, the page has no `seo` component yet, the
 * write does not name one and no meta description can be derived (no paragraph of 50 characters),
 * the middleware creates none: a component that holds a title and no description would be stored by
 * the draft and refused when the page is published (Strapi checks `required` only on the published
 * copy). A host that does not require it gets the meta title, as before. The page is refused when
 * it leaves `draft` in the editorial workflow, with `metaDescriptionMissing`. A write that names
 * `seo` is sent as written, and an existing component is updated in place as always.
 *
 * @throws ValidationError (400) with the code `structuredDataInvalid` for structured data that is
 * not a JSON-LD object or a list of them.
 */
export function seoDocuments(strapi: Core.Strapi): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    if (context.action !== 'create' && context.action !== 'update') return next()
    const uid = context.uid as UID.ContentType
    const schema = strapi.contentTypes[uid]
    if (!schema || !hasPageSettings(schema) || !hasSeo(schema)) return next()
    const params = context.params as Params
    const data = params.data
    if (!data) return next()
    const given = data[SEO_ATTRIBUTE]
    const own =
      typeof given === 'object' && given !== null ? (given as Record<string, unknown>) : {}
    if ('structuredData' in own) {
      const problem = structuredDataProblem(own.structuredData)
      if (problem) {
        throw new errors.ValidationError(`The structured data is not valid JSON-LD: ${problem}`, {
          code: STRUCTURED_DATA_INVALID,
          field: 'structuredData',
        })
      }
    }
    const zones = zonesOf(strapi, uid)
    if (!('title' in data) && !(SEO_ATTRIBUTE in data) && !zones.some((zone) => zone in data)) {
      return next()
    }
    const current =
      context.action === 'update' && params.documentId
        ? await readSeoDraft(strapi, {
            uid,
            documentId: params.documentId,
            locale: text(params.locale) || null,
          })
        : null
    const effective: SeoDraft = {
      title: 'title' in data ? text(data.title) : (current?.title ?? ''),
      siteName: current?.siteName ?? '',
      zones: Object.fromEntries(
        zones.map((zone) => [
          zone,
          zone in data
            ? Array.isArray(data[zone])
              ? (data[zone] as unknown[])
              : []
            : (current?.zones[zone] ?? []),
        ])
      ),
      seo: {
        id: current?.seo.id,
        metaTitle: 'metaTitle' in own ? text(own.metaTitle) : (current?.seo.metaTitle ?? ''),
        metaDescription:
          'metaDescription' in own
            ? text(own.metaDescription)
            : (current?.seo.metaDescription ?? ''),
        image:
          'metaImage' in own ? await fileOf(strapi, own.metaImage) : (current?.seo.image ?? null),
      },
    }
    if (!current && 'site' in data) {
      const siteId = documentIdOf(data.site)
      const site = siteId
        ? ((await strapi.documents(SITE_UID as UID.ContentType).findOne({
            documentId: siteId,
            fields: ['name', 'slug'],
          } as never)) as { name?: unknown; slug?: unknown } | null)
        : null
      effective.siteName = text(site?.name) || text(site?.slug)
    }
    const derived = await derivedFor(strapi, effective)
    // No component yet and nothing to derive a description from: a new component would hold a title
    // alone, which the draft stores and a host whose component requires the description refuses when
    // the page is published. A host that does not require it keeps the title, as before.
    const wouldCreateWithoutDescription =
      !(SEO_ATTRIBUTE in data) &&
      effective.seo.id === undefined &&
      !derived.metaDescription &&
      requiresDescription(strapi)
    // The component the draft has is updated in place: a `seo` without its `id` would replace it,
    // and the fields the write does not name would be lost.
    if (
      !wouldCreateWithoutDescription &&
      (SEO_ATTRIBUTE in data || Object.keys(derived).length > 0)
    ) {
      data[SEO_ATTRIBUTE] = {
        ...(effective.seo.id !== undefined && own.id === undefined ? { id: effective.seo.id } : {}),
        ...own,
        ...derived,
      }
    }
    return next()
  }
}
