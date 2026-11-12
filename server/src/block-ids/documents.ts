import type { Core, Modules, Schema, UID } from '@strapi/strapi'
import { assignIds, BLOCK_ID, ITEM_ID, type Entry } from './rules'

/** The actions that write `data`; `clone` takes it too (the Content Manager's duplicate). */
const WRITE_ACTIONS: ReadonlySet<string> = new Set(['create', 'update', 'clone'])

type Params = Record<string, unknown> & {
  data?: Record<string, unknown>
  documentId?: string
  locale?: string
}

type Attributes = Record<string, Schema.Attribute.AnyAttribute>

/**
 * The document service middleware that gives every block of a dynamic zone a `blockId` and every
 * repeatable item of a block an `itemId` (ADR-0018, section 1).
 *
 * @remarks
 * On `create`, `update` and `clone` of any type, for each dynamic zone the data names: a block whose
 * component declares a `blockId` and has none gets an id unique in the zone, and so does an item
 * whose component declares an `itemId`, unique in its parent block. On `update` the draft's stored
 * ids win over what the save writes (`assignIds`): an edit never changes an id, a reorder moves it
 * with its block, and a save that omits ids keeps the stored ones. A component that declares no
 * such field (a host that has not adopted them) is left alone, as is a zone the data does not name.
 * Ids a `create` or a `clone` brings, an import's among them, are kept when unique.
 */
export function blockIdsDocuments(strapi: Core.Strapi): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    if (!WRITE_ACTIONS.has(context.action)) return next()
    const params = context.params as Params
    const data = params.data
    if (data) {
      const uid = context.uid as UID.ContentType
      const attributes = strapi.contentType(uid).attributes as Attributes
      const zones = Object.entries(attributes).filter(
        ([name, attribute]) => attribute.type === 'dynamiczone' && Array.isArray(data[name])
      )
      if (zones.length > 0) {
        const stored =
          context.action === 'update' ? await storedZones(strapi, uid, params, zones) : {}
        for (const [name] of zones) fillZone(strapi, data[name] as unknown[], stored[name] ?? [])
      }
    }
    return next()
  }
}

/** Gives the blocks of a zone, and their items, their ids. */
function fillZone(strapi: Core.Strapi, blocks: unknown[], stored: Entry[]): void {
  const attributesOf = (component: unknown): Attributes =>
    (strapi.components[component as UID.Component]?.attributes ?? {}) as Attributes
  const identified = (entry: unknown): entry is Entry =>
    typeof entry === 'object' &&
    entry !== null &&
    BLOCK_ID in attributesOf((entry as Entry).__component)
  // Only the blocks whose component declares `blockId` are numbered; the others are no one's counterpart.
  const own = blocks.filter(identified)
  assignIds(own, stored.filter(identified), BLOCK_ID)
  const storedBy = new Map(stored.map((block) => [block[BLOCK_ID], block]))
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue
    const entry = block as Entry
    const before = storedBy.get(entry[BLOCK_ID])
    for (const [name, attribute] of Object.entries(attributesOf(entry.__component))) {
      const items = entry[name]
      if (attribute.type !== 'component' || !attribute.repeatable || !Array.isArray(items)) continue
      if (!(ITEM_ID in attributesOf(attribute.component))) continue
      const storedItems =
        before && before.__component === entry.__component ? before[name] : undefined
      assignIds(items, Array.isArray(storedItems) ? (storedItems as Entry[]) : [], ITEM_ID)
    }
  }
}

/**
 * The stored draft's blocks of each zone, with the item lists their components hold.
 *
 * @remarks
 * Read straight from the database, so it neither goes through the document service middlewares nor
 * needs the request's site.
 */
async function storedZones(
  strapi: Core.Strapi,
  uid: UID.ContentType,
  params: Params,
  zones: [string, Schema.Attribute.AnyAttribute][]
): Promise<Record<string, Entry[]>> {
  if (!params.documentId) return {}
  const model = strapi.contentType(uid)
  const populate = Object.fromEntries(
    zones.map(([name, attribute]) => [
      name,
      {
        on: Object.fromEntries(
          ((attribute as { components: string[] }).components ?? []).map((component) => [
            component,
            { populate: repeatables(strapi, component) },
          ])
        ),
      },
    ])
  )
  const localized =
    (model.pluginOptions as { i18n?: { localized?: boolean } } | undefined)?.i18n?.localized ===
    true
  let locale = params.locale
  if (localized && !locale) {
    const i18n = strapi.plugin('i18n') as
      { service: (name: string) => { getDefaultLocale: () => Promise<string> } } | undefined
    locale = await i18n?.service('locales').getDefaultLocale()
  }
  const row = (await strapi.db.query(uid).findOne({
    where: {
      documentId: params.documentId,
      ...(localized && locale ? { locale } : {}),
      ...(model.options?.draftAndPublish ? { publishedAt: null } : {}),
    },
    populate,
  })) as Record<string, Entry[] | null> | null
  return Object.fromEntries(zones.map(([name]) => [name, row?.[name] ?? []]))
}

/** The repeatable component attributes of a component, as a `populate` of their own. */
function repeatables(strapi: Core.Strapi, component: string): Record<string, true> {
  const attributes = (strapi.components[component as UID.Component]?.attributes ?? {}) as Attributes
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([, attribute]) => attribute.type === 'component' && attribute.repeatable)
      .map(([name]) => [name, true as const])
  )
}
