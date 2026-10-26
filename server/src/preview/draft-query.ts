import type { Core, Schema, UID } from '@strapi/strapi'
import { isSiteScoped, SITE_ATTRIBUTE } from '../site-scope'

type Entry = Record<string, unknown>

/** The attribute of a schema, read loosely: the shapes that differ by type are checked by `type`. */
interface AttributeLike {
  type: string
  private?: boolean
  target?: unknown
  component?: string
  components?: string[]
}

/** A `populate` the draft read accepts: the names it asks for, or every first-level relation (`*`). */
export interface PopulateSpec {
  /** The `*` populate: no names, the first level of every relation, component and media. */
  all: boolean
  children: Map<string, PopulateNode>
}

/** What is asked of one populated attribute. */
export interface PopulateNode {
  /** The fields of the attribute's entry, or all of its scalar fields when absent. */
  fields?: string[]
  /** Under a component, its own populate; under a relation, only media attributes of the related entry. */
  populate?: PopulateSpec
  /** For a dynamic zone, the options of each component fragment, by component UID. */
  on?: Map<string, PopulateNode>
}

/** The answer of {@link readDraftQuery}: why the query cannot be served, or what it asks for. */
export type DraftQuery = { problem: string } | { populate: PopulateSpec }

const FILE_UID = 'plugin::upload.file'
const QUERY_KEYS = new Set(['populate', 'site'])
const ALWAYS_FIELDS = new Set(['id', 'documentId', 'createdAt', 'updatedAt'])
const NOT_SCALAR = new Set(['relation', 'component', 'dynamiczone', 'media'])
const NO_POPULATE: PopulateSpec = { all: false, children: new Map() }

/** A refusal with the reason the client reads; thrown inside the parser, answered by {@link readDraftQuery}. */
class QueryProblem extends Error {}

/**
 * Reads the query of the draft route against the draft's schema, and answers what it may populate or why it is refused.
 *
 * @remarks
 * The route serves one document its grant names (ADR-0019, section 3), so the query is an allowlist
 * and not Strapi's whole query language: only `populate` (and `site`, which the site-scope
 * middleware has already read) is accepted; `filters`, `sort`, `fields`, `pagination` and any other
 * key are refused, because a filter that follows a relation tells whether an entry the answer leaves
 * out matches. A `populate` may name the attributes of the draft and, inside its components and
 * dynamic zones, of those, at any depth. Through a relation it goes one level: the `fields` of the
 * related entry and, as `populate`, its media attributes with `fields` only. Through a media
 * attribute it is `fields` only, so the file's `related` relation is never reached. A name that is
 * not an attribute, a private attribute and a relation to an admin user or to no type are refused.
 *
 * @returns The reason when the query is refused, else the populate to serve.
 */
export function readDraftQuery(
  strapi: Core.Strapi,
  query: Record<string, unknown>,
  schema: Schema.ContentType
): DraftQuery {
  try {
    for (const key of Object.keys(query)) {
      if (!QUERY_KEYS.has(key)) {
        throw new QueryProblem(
          `The draft read takes only documentId, locale and populate, not "${key}"`
        )
      }
    }
    return { populate: parsePopulate(strapi, query.populate, schema, 'document', 'populate') }
  } catch (error) {
    if (error instanceof QueryProblem) return { problem: error.message }
    throw error
  }
}

/**
 * Reads the draft of a document with the populate {@link readDraftQuery} accepted, and answers `null` when there is none.
 *
 * @remarks
 * The draft itself is read as the grant says. Every entry it populates through a relation is then
 * read again as its **published** version, with the fields the client asked for: a grant serves the
 * draft of the one document it names and never the draft of another. A related entry that has no
 * published version, one of another site and a polymorphic relation are left out. The API token's
 * abilities still decide which relations the answer keeps (`sanitize.query` and `sanitize.output`).
 *
 * @param auth - The content API's authentication of the request, for the token's abilities.
 * @throws `ValidationError` or `PaginationError` when Strapi refuses the query after all; the caller answers `400`.
 */
export async function readDraft(
  strapi: Core.Strapi,
  options: {
    uid: UID.ContentType
    documentId: string
    locale: string | undefined
    populate: PopulateSpec
    siteDocumentId: string
    auth: unknown
  }
): Promise<Entry | null> {
  const schema = strapi.contentType(options.uid)
  const params = await strapi.contentAPI.sanitize.query(
    { populate: draftPopulate(strapi, options.populate, schema) },
    schema,
    { auth: options.auth } as never
  )
  const entry = (await strapi.documents(options.uid).findOne({
    ...params,
    documentId: options.documentId,
    locale: options.locale,
    status: 'draft',
  } as never)) as Entry | null
  if (!entry) return null
  await publishedRelations(strapi, entry, schema, options.populate)
  await keepToSite(strapi, entry, schema, options.siteDocumentId)
  return entry
}

function fail(message: string): never {
  throw new QueryProblem(message)
}

function attributeOf(
  schema: Schema.ContentType | Schema.Component,
  name: string
): AttributeLike | undefined {
  return Object.prototype.hasOwnProperty.call(schema.attributes, name)
    ? (schema.attributes[name] as AttributeLike)
    : undefined
}

/** A populate as a list of `[name, options]` pairs, whatever form the query string gave it. */
function expand(value: unknown, path: string): { all: boolean; pairs: [string, unknown][] } {
  const found = { all: false, pairs: [] as [string, unknown][] }
  const add = (part: unknown): void => {
    if (part === undefined || part === null || part === false || part === 'false') return
    if (part === true || part === 'true') {
      found.all = true
    } else if (typeof part === 'string') {
      for (const name of part.split(',').map((piece) => piece.trim())) {
        if (name === '') continue
        if (name === '*') found.all = true
        else {
          const [head = '', ...rest] = name.split('.')
          found.pairs.push([head, rest.length > 0 ? { populate: rest.join('.') } : true])
        }
      }
    } else if (Array.isArray(part)) {
      for (const item of part) {
        if (typeof item !== 'string' && (typeof item !== 'object' || item === null)) {
          fail(`${path} must be a name, a list of names or an object`)
        }
        add(item)
      }
    } else if (typeof part === 'object') {
      found.pairs.push(...Object.entries(part))
    } else {
      fail(`${path} must be a name, a list of names or an object`)
    }
  }
  add(value)
  return found
}

function parsePopulate(
  strapi: Core.Strapi,
  value: unknown,
  schema: Schema.ContentType | Schema.Component,
  scope: 'document' | 'related',
  path: string
): PopulateSpec {
  const { all, pairs } = expand(value, path)
  if (all && pairs.length > 0) fail(`${path} cannot mix "*" with names`)
  if (all && scope === 'related') fail(`${path} cannot be "*" under a relation`)
  const children = new Map<string, PopulateNode>()
  for (const [name, sub] of pairs) {
    const here = `${path}[${name}]`
    const attribute = attributeOf(schema, name)
    if (!attribute || attribute.private === true) fail(`${here} is not an attribute of the type`)
    if (scope === 'related' && attribute.type !== 'media') {
      fail(`${here}: under a relation only a media attribute may be populated`)
    }
    if (children.has(name)) fail(`${here} is named twice`)
    const node = parseNode(strapi, sub, attribute, here)
    if (node) children.set(name, node)
  }
  return { all, children }
}

function parseNode(
  strapi: Core.Strapi,
  sub: unknown,
  attribute: AttributeLike,
  path: string
): PopulateNode | undefined {
  if (sub === false || sub === 'false') return undefined
  const options = sub === true || sub === 'true' || sub === '' ? {} : sub
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    fail(`${path} must be true or an object`)
  }
  const given = options as Record<string, unknown>
  const only = (...keys: string[]): void => {
    for (const key of Object.keys(given)) {
      if (!keys.includes(key)) fail(`${path} does not take "${key}"`)
    }
  }
  switch (attribute.type) {
    case 'media':
      only('fields')
      return { fields: fieldsOf(given.fields, strapi.contentType(FILE_UID), path) }
    case 'relation': {
      only('fields', 'populate')
      const target = relationTarget(strapi, attribute, path)
      const schema = strapi.contentType(target)
      const node: PopulateNode = { fields: fieldsOf(given.fields, schema, path) }
      if (given.populate !== undefined) {
        node.populate = parsePopulate(
          strapi,
          given.populate,
          schema,
          'related',
          `${path}[populate]`
        )
      }
      return node
    }
    case 'component':
      only('fields', 'populate')
      return componentNode(strapi, given, attribute.component as UID.Component, path)
    case 'dynamiczone': {
      only('on')
      if (given.on === undefined) return {}
      if (typeof given.on !== 'object' || given.on === null || Array.isArray(given.on)) {
        fail(`${path}[on] must be an object`)
      }
      const on = new Map<string, PopulateNode>()
      for (const [uid, fragment] of Object.entries(given.on)) {
        if (!attribute.components?.includes(uid))
          fail(`${path}[on][${uid}] is not a component of the zone`)
        const node = parseNode(
          strapi,
          fragment,
          { type: 'component', component: uid },
          `${path}[on][${uid}]`
        )
        if (node) on.set(uid, node)
      }
      return { on }
    }
    default:
      return fail(`${path} is not a relation, a component, a dynamic zone or a media attribute`)
  }
}

function componentNode(
  strapi: Core.Strapi,
  given: Record<string, unknown>,
  uid: UID.Component,
  path: string
): PopulateNode {
  const component = strapi.components[uid]
  const node: PopulateNode = { fields: fieldsOf(given.fields, component, path) }
  if (given.populate !== undefined) {
    node.populate = parsePopulate(
      strapi,
      given.populate,
      component,
      'document',
      `${path}[populate]`
    )
  }
  return node
}

/** The type a relation points to, when it is one the draft read may follow. */
function relationTarget(
  strapi: Core.Strapi,
  attribute: AttributeLike,
  path: string
): UID.ContentType {
  const target = attribute.target
  if (
    typeof target !== 'string' ||
    target.startsWith('admin::') ||
    !(target in strapi.contentTypes)
  ) {
    return fail(`${path} is a relation the draft read does not follow`)
  }
  return target as UID.ContentType
}

function fieldsOf(
  value: unknown,
  schema: Schema.ContentType | Schema.Component,
  path: string
): string[] | undefined {
  if (value === undefined) return undefined
  const names = (Array.isArray(value) ? value : [value]).flatMap((item) => {
    if (typeof item !== 'string') return fail(`${path}[fields] must be names of fields`)
    return item.split(',').map((piece) => piece.trim())
  })
  for (const name of names) {
    const attribute = attributeOf(schema, name)
    const known = ALWAYS_FIELDS.has(name) || (attribute !== undefined && attribute.private !== true)
    if (!known || (attribute !== undefined && NOT_SCALAR.has(attribute.type))) {
      fail(`${path}[fields]: "${name}" is not a field of the type`)
    }
  }
  return names.filter((name) => name !== '')
}

/**
 * The populate handed to Strapi for the draft: what the draft itself holds, and a relation as
 * its bare entry, which {@link publishedRelations} replaces.
 */
function draftPopulate(
  strapi: Core.Strapi,
  spec: PopulateSpec,
  schema: Schema.ContentType | Schema.Component
): unknown {
  if (spec.all) return '*'
  const populate: Record<string, unknown> = {}
  for (const [name, node] of spec.children) {
    const attribute = attributeOf(schema, name)
    if (attribute?.type === 'media') {
      populate[name] = node.fields ? { fields: node.fields } : true
    } else if (attribute?.type === 'component') {
      populate[name] = componentPopulate(strapi, node, attribute.component as UID.Component)
    } else if (attribute?.type === 'dynamiczone') {
      populate[name] = node.on
        ? {
            on: Object.fromEntries(
              [...node.on].map(([uid, fragment]) => [
                uid,
                componentPopulate(strapi, fragment, uid as UID.Component),
              ])
            ),
          }
        : true
    } else {
      populate[name] = true
    }
  }
  return populate
}

function componentPopulate(strapi: Core.Strapi, node: PopulateNode, uid: UID.Component): unknown {
  const options: Record<string, unknown> = {}
  if (node.fields) options.fields = node.fields
  if (node.populate) options.populate = draftPopulate(strapi, node.populate, strapi.components[uid])
  return Object.keys(options).length > 0 ? options : true
}

/** Replaces each entry a relation populated with its published version, read with the fields asked. */
async function publishedRelations(
  strapi: Core.Strapi,
  entry: Entry,
  schema: Schema.ContentType | Schema.Component,
  spec: PopulateSpec
): Promise<void> {
  for (const [name, attribute] of Object.entries(schema.attributes) as [string, AttributeLike][]) {
    const value = entry[name]
    if (value === undefined || value === null) continue
    const node = spec.children.get(name) ?? (spec.all ? {} : undefined)
    if (attribute.type === 'relation') {
      // A polymorphic relation has no target to read the published version of.
      if (typeof attribute.target !== 'string') {
        delete entry[name]
        continue
      }
      const target = attribute.target as UID.ContentType
      const published: Entry[] = []
      for (const related of Array.isArray(value) ? (value as Entry[]) : [value as Entry]) {
        const read = await publishedOf(strapi, target, related, node ?? {})
        if (read) published.push(read)
      }
      entry[name] = Array.isArray(value) ? published : (published[0] ?? null)
    } else if (attribute.type === 'component') {
      const component = strapi.components[attribute.component as UID.Component]
      for (const child of Array.isArray(value) ? (value as Entry[]) : [value as Entry]) {
        await publishedRelations(strapi, child, component, node?.populate ?? NO_POPULATE)
      }
    } else if (attribute.type === 'dynamiczone') {
      for (const child of value as Entry[]) {
        const uid = child.__component as UID.Component
        if (!(uid in strapi.components)) continue
        await publishedRelations(
          strapi,
          child,
          strapi.components[uid],
          node?.on?.get(uid)?.populate ?? NO_POPULATE
        )
      }
    }
  }
}

async function publishedOf(
  strapi: Core.Strapi,
  target: UID.ContentType,
  related: Entry,
  node: PopulateNode
): Promise<Entry | null> {
  if (typeof related.documentId !== 'string') return null
  const media: Record<string, unknown> = {}
  for (const [name, child] of node.populate?.children ?? []) {
    media[name] = child.fields ? { fields: child.fields } : true
  }
  return (await strapi.documents(target).findOne({
    documentId: related.documentId,
    locale: typeof related.locale === 'string' ? related.locale : undefined,
    status: 'published',
    fields: node.fields,
    populate: Object.keys(media).length > 0 ? media : undefined,
  } as never)) as Entry | null
}

/** Receives the entries a relation holds and answers the ones to keep. */
type Visitor = (target: UID.ContentType, entries: Entry[]) => Promise<Entry[]>

/**
 * Removes from a draft the populated entries that belong to another site, at any depth.
 *
 * @remarks
 * The grant names one document of one site (ADR-0019, section 3), and a `populate` may follow its
 * relations to entries of any site, which the document service middleware does not filter. An
 * entry of a site-scoped type stays only when its published version belongs to `siteDocumentId`;
 * an entry whose site cannot be told (a `fields` that left out the `documentId`) and a polymorphic
 * relation go too. Entries of types that are not site-scoped (media, users) are not touched here:
 * what a token may read of them is the sanitising's.
 *
 * @param entry - The draft as the document service read it; changed in place.
 */
async function keepToSite(
  strapi: Core.Strapi,
  entry: Entry,
  schema: Schema.ContentType,
  siteDocumentId: string
): Promise<void> {
  const found = new Map<UID.ContentType, Set<string>>()
  await walk(strapi, entry, schema, async (target, entries) => {
    if (!isSiteScoped(strapi.contentType(target))) return entries
    const ids = found.get(target) ?? new Set<string>()
    for (const { documentId } of entries) if (typeof documentId === 'string') ids.add(documentId)
    found.set(target, ids)
    return entries
  })
  if (found.size === 0) return

  const owned = new Map<UID.ContentType, Set<string>>()
  for (const [target, ids] of found) {
    // A related entry is served as published: its published row decides the site.
    const published = strapi.contentType(target).options?.draftAndPublish === true
    const rows = (await strapi.db.query(target).findMany({
      select: ['documentId'],
      where: {
        documentId: { $in: [...ids] },
        [SITE_ATTRIBUTE]: { documentId: siteDocumentId },
        ...(published ? { publishedAt: { $notNull: true } } : {}),
      },
    })) as { documentId: string }[]
    owned.set(target, new Set(rows.map((row) => row.documentId)))
  }
  await walk(strapi, entry, schema, async (target, entries) => {
    const ids = owned.get(target)
    if (!isSiteScoped(strapi.contentType(target))) return entries
    return entries.filter(
      ({ documentId }) => typeof documentId === 'string' && ids?.has(documentId) === true
    )
  })
}

/** Goes through the relations of an entry, in its components and dynamic zones too, depth first. */
async function walk(
  strapi: Core.Strapi,
  entry: Entry,
  schema: Schema.ContentType | Schema.Component,
  visit: Visitor
): Promise<void> {
  for (const [name, attribute] of Object.entries(schema.attributes)) {
    const value = entry[name]
    if (value === undefined || value === null) continue
    if (attribute.type === 'relation') {
      // A polymorphic relation has no target to look the site up in.
      if (!('target' in attribute) || typeof attribute.target !== 'string') {
        delete entry[name]
        continue
      }
      const target = attribute.target as UID.ContentType
      const many = Array.isArray(value)
      const kept = await visit(target, many ? (value as Entry[]) : [value as Entry])
      for (const child of kept) await walk(strapi, child, strapi.contentType(target), visit)
      entry[name] = many ? kept : (kept[0] ?? null)
    } else if (attribute.type === 'component') {
      const component = strapi.components[attribute.component]
      for (const child of Array.isArray(value) ? (value as Entry[]) : [value as Entry]) {
        await walk(strapi, child, component, visit)
      }
    } else if (attribute.type === 'dynamiczone') {
      for (const child of value as Entry[]) {
        const component = strapi.components[child.__component as UID.Component]
        if (component) await walk(strapi, child, component, visit)
      }
    }
  }
}
