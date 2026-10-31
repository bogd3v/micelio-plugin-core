// From the rows Strapi stores to the `data` of a version (`docs/export-format.md`, "Attributes").
import { BLOCKS } from '../../../contract/blocks'
import { exportPolicyOf, isWritten } from './names'
import type { ExportValue, MediaRef } from './types'

/** A Strapi attribute as the loaded schema holds it. */
export interface Attribute {
  type: string
  relation?: string
  target?: string
  mappedBy?: string
  multiple?: boolean
  repeatable?: boolean
  component?: string
  components?: string[]
  private?: boolean
  pluginOptions?: Record<string, unknown>
}

/** The attributes of a content type or a component. */
export type Attributes = Record<string, Attribute>

/** A stored file, as a populated media attribute holds it. */
export interface StoredFile {
  id: number
  [key: string]: unknown
}

/** What serialising needs besides the row. */
export interface SerialiseContext {
  /** The attributes of a component, by its UID. */
  componentAttributes(uid: string): Attributes
  /** The export name of a relation's target, or `undefined` when the archive does not hold it. */
  exportNameOf(uid: string): string | undefined
  /** The reference that stands for a file in `data`; `null` when the export leaves media out. */
  mediaRef(file: StoredFile): MediaRef | null
  personal: boolean
}

type Row = Record<string, unknown>

/** Attributes that are the version's own fields or Strapi's bookkeeping, never part of `data`. */
export const SYSTEM_ATTRIBUTES = new Set([
  'id',
  'documentId',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'locale',
  'localizations',
])

const BLOCK_IDS = new Map(BLOCKS.map((block) => [block.schema.component, block.id]))

/**
 * The `populate` of a query that loads everything {@link serialiseData} writes.
 *
 * @param skip - Attributes of the top level to leave out, such as the `site` relation.
 */
export function populateOf(
  attributes: Attributes,
  context: SerialiseContext,
  skip: ReadonlySet<string> = new Set()
): Record<string, unknown> {
  const populate: Record<string, unknown> = {}
  for (const [name, attribute] of writtenAttributes(attributes, context, skip)) {
    if (attribute.type === 'media') populate[name] = true
    if (attribute.type === 'relation') populate[name] = { select: ['documentId'] }
    if (attribute.type === 'component') {
      populate[name] = nested(context.componentAttributes(attribute.component ?? ''), context)
    }
    if (attribute.type === 'dynamiczone') {
      populate[name] = {
        on: Object.fromEntries(
          (attribute.components ?? []).map((uid) => [
            uid,
            nested(context.componentAttributes(uid), context),
          ])
        ),
      }
    }
  }
  return populate
}

/**
 * The `data` of a version: every attribute the archive writes, in the schema's order.
 *
 * @param skip - Attributes of the top level to leave out, such as the `site` relation.
 * @throws `Error` for an attribute type format 1.0 does not define.
 */
export function serialiseData(
  attributes: Attributes,
  row: Row,
  context: SerialiseContext,
  skip: ReadonlySet<string> = new Set()
): Record<string, ExportValue> {
  const data: Record<string, ExportValue> = {}
  for (const [name, attribute] of writtenAttributes(attributes, context, skip)) {
    data[name] = serialiseValue(attribute, row[name], context)
  }
  return data
}

/** A stored date and time in RFC 3339, UTC, with milliseconds; `null` when there is none. */
export function toTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value as string | number)
  if (Number.isNaN(date.getTime())) throw new Error(`"${String(value)}" is not a date and time`)
  return date.toISOString()
}

function nested(attributes: Attributes, context: SerialiseContext): unknown {
  const populate = populateOf(attributes, context)
  return Object.keys(populate).length === 0 ? true : { populate }
}

function writtenAttributes(
  attributes: Attributes,
  context: SerialiseContext,
  skip: ReadonlySet<string>
): [string, Attribute][] {
  return Object.entries(attributes).filter(
    ([name, attribute]) =>
      !SYSTEM_ATTRIBUTES.has(name) &&
      !skip.has(name) &&
      isWritten(exportPolicyOf(attribute), context.personal) &&
      // The side declared with `mappedBy` is rebuilt by the import from the owning side.
      !(attribute.type === 'relation' && attribute.mappedBy)
  )
}

function serialiseValue(
  attribute: Attribute,
  value: unknown,
  context: SerialiseContext
): ExportValue {
  switch (attribute.type) {
    case 'string':
    case 'text':
    case 'richtext':
    case 'email':
    case 'uid':
    case 'enumeration':
    case 'time':
      return value === null || value === undefined ? null : String(value)
    case 'integer':
    case 'float':
    case 'decimal':
      return value === null || value === undefined ? null : Number(value)
    case 'biginteger':
      return value === null || value === undefined ? null : String(value)
    case 'boolean':
      return value === null || value === undefined ? null : Boolean(value)
    case 'datetime':
    case 'timestamp':
      return toTimestamp(value)
    case 'date':
      return value === null || value === undefined
        ? null
        : value instanceof Date
          ? value.toISOString().slice(0, 10)
          : String(value)
    case 'json':
    case 'blocks':
      return value === undefined ? null : (value as ExportValue)
    case 'media':
      if (attribute.multiple) {
        return asList(value)
          .map((file) => mediaOf(file, context))
          .filter((ref) => ref !== null)
      }
      return value ? mediaOf(value, context) : null
    case 'relation':
      return relationOf(attribute, value, context)
    case 'component': {
      const component = context.componentAttributes(attribute.component ?? '')
      if (attribute.repeatable) {
        return asList(value).map((item) => serialiseData(component, item as Row, context))
      }
      return value ? serialiseData(component, value as Row, context) : null
    }
    case 'dynamiczone':
      return asList(value).map((item) => blockOf(item as Row, context))
    default:
      throw new Error(`Format 1.0 does not define the attribute type "${attribute.type}"`)
  }
}

function relationOf(attribute: Attribute, value: unknown, context: SerialiseContext): ExportValue {
  const name = attribute.target ? context.exportNameOf(attribute.target) : undefined
  const toMany = attribute.relation?.endsWith('ToMany') ?? false
  // A relation to a type the archive does not hold (an admin user, a reader account) is empty.
  if (!name) return toMany ? [] : null
  // Strapi links a draft to the drafts of the target and a published row to the published ones;
  // the archive keeps one reference per document.
  const ids = [...new Set(asList(value).map((row) => String((row as Row).documentId)))]
  const refs = ids.map((documentId) => ({ ref: name, documentId }))
  return toMany ? refs : (refs[0] ?? null)
}

function blockOf(item: Row, context: SerialiseContext): ExportValue {
  const uid = String(item.__component)
  const block = BLOCK_IDS.get(uid)
  return {
    __component: uid,
    ...(block ? { block } : {}),
    ...serialiseData(context.componentAttributes(uid), item, context),
  }
}

function mediaOf(file: unknown, context: SerialiseContext): ExportValue {
  return context.mediaRef(file as StoredFile) as unknown as ExportValue
}

function asList(value: unknown): unknown[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}
