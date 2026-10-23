// From the `data` of a version to what the document service writes, checked against the
// target's schema (`docs/export-format.md`, "Attributes" and "Import").
import { BLOCKS } from '../../../contract/blocks'
import { ExportError } from './errors'
import { SYSTEM_ATTRIBUTES, type Attribute, type Attributes } from './serialise'

/** Where a reference of the archive points on the target. */
export type RefState = 'present' | 'later' | 'missing'

/** What deserialising needs besides the data. */
export interface DeserialiseContext {
  /** The attributes of a component the target registers, or `undefined`. */
  componentAttributes(uid: string): Attributes | undefined
  /** The export name of a content type of the target, or `undefined` when it has none. */
  exportNameOf(uid: string): string | undefined
  /** Whether the referenced document exists on the target, will be written later, or neither. */
  refState(name: string, documentId: string): RefState
  /** The id of the target's file for a media digest, or `undefined` before the media is stored. */
  fileOf(sha256: string): number | undefined
  /** Whether the archive holds a media file with this digest. */
  hasMedia(sha256: string): boolean
}

/** What a version's data becomes, and what of it could not be written yet. */
export interface Deserialised {
  data: Record<string, unknown>
  /** References to documents the import writes later: the version is written again then. */
  pending: number
  /** References to documents neither the archive nor the target holds: left out. */
  missing: number
}

const COMPONENT_OF_BLOCK = new Map(BLOCKS.map((block) => [block.id, block.schema.component]))
const DATE = /^\d{4}-\d\d-\d\d$/

/**
 * The document service data of a version, with the attributes the target does not have left out.
 *
 * @param where - Where the data is, for the message of a refusal.
 * @throws `ExportError` `exportDocumentInvalid` when a value does not fit its attribute.
 */
export function deserialiseData(
  attributes: Attributes,
  data: Record<string, unknown>,
  context: DeserialiseContext,
  where: string
): Deserialised {
  const result: Deserialised = { data: {}, pending: 0, missing: 0 }
  for (const [name, value] of Object.entries(data)) {
    const attribute = attributes[name]
    // An attribute of a newer minor, or one the target dropped: ignored (section "Versions").
    if (!attribute || SYSTEM_ATTRIBUTES.has(name)) continue
    result.data[name] = valueOf(attribute, value, context, `${where}.${name}`, result)
  }
  return result
}

/**
 * The data of a version with only the attributes the target has, for comparing it with what the
 * target holds.
 */
export function knownData(
  attributes: Attributes,
  data: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).filter(([name]) => attributes[name] && !SYSTEM_ATTRIBUTES.has(name))
  )
}

function valueOf(
  attribute: Attribute,
  value: unknown,
  context: DeserialiseContext,
  where: string,
  result: Deserialised
): unknown {
  if (value === null || value === undefined) {
    if (attribute.type === 'dynamiczone') return []
    if (attribute.type === 'component' && attribute.repeatable) return []
    if (attribute.type === 'media' && attribute.multiple) return []
    return null
  }
  switch (attribute.type) {
    case 'string':
    case 'text':
    case 'richtext':
    case 'email':
    case 'uid':
    case 'time':
    case 'biginteger':
      return expect(typeof value === 'string', value, where)
    case 'enumeration': {
      const allowed = (attribute as { enum?: string[] }).enum ?? []
      return expect(typeof value === 'string' && allowed.includes(value), value, where)
    }
    case 'integer':
      return expect(Number.isInteger(value), value, where)
    case 'float':
    case 'decimal':
      return expect(typeof value === 'number' && Number.isFinite(value), value, where)
    case 'boolean':
      return expect(typeof value === 'boolean', value, where)
    case 'datetime':
    case 'timestamp':
      return expect(typeof value === 'string' && !Number.isNaN(Date.parse(value)), value, where)
    case 'date':
      return expect(typeof value === 'string' && DATE.test(value), value, where)
    case 'json':
    case 'blocks':
      return value
    case 'media':
      if (attribute.multiple) {
        return list(value, where).map((item, i) => mediaOf(item, context, `${where}.${i}`))
      }
      return mediaOf(value, context, where)
    case 'relation':
      return relationOf(attribute, value, context, where, result)
    case 'component': {
      const component = context.componentAttributes(attribute.component ?? '')
      if (!component) throw invalid(where, `component ${attribute.component} is not registered`)
      if (attribute.repeatable) {
        return list(value, where).map((item, i) =>
          componentOf(component, item, context, `${where}.${i}`, result)
        )
      }
      return componentOf(component, value, context, where, result)
    }
    case 'dynamiczone':
      return list(value, where).map((item, i) =>
        blockOf(attribute, item, context, `${where}.${i}`, result)
      )
    default:
      throw invalid(where, `the target's attribute type "${attribute.type}" is not in format 1.0`)
  }
}

function relationOf(
  attribute: Attribute,
  value: unknown,
  context: DeserialiseContext,
  where: string,
  result: Deserialised
): unknown {
  const toMany = attribute.relation?.endsWith('ToMany') ?? false
  const expected = attribute.target ? context.exportNameOf(attribute.target) : undefined
  const refs = toMany ? list(value, where) : [value]
  const ids: string[] = []
  for (const ref of refs) {
    const { ref: name, documentId } = (ref ?? {}) as { ref?: unknown; documentId?: unknown }
    if (typeof name !== 'string' || typeof documentId !== 'string') {
      throw invalid(where, 'a reference needs ref and documentId')
    }
    // The archive points at a type this attribute does not hold: not a reference it can take.
    if (name !== expected) throw invalid(where, `"${name}" is not the type of the relation`)
    const state = context.refState(name, documentId)
    if (state === 'present') ids.push(documentId)
    else if (state === 'later') result.pending += 1
    else result.missing += 1
  }
  return toMany ? ids : (ids[0] ?? null)
}

function componentOf(
  attributes: Attributes,
  value: unknown,
  context: DeserialiseContext,
  where: string,
  result: Deserialised
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(where, 'a component is an object')
  }
  const nested = deserialiseData(attributes, value as Record<string, unknown>, context, where)
  result.pending += nested.pending
  result.missing += nested.missing
  return nested.data
}

function blockOf(
  attribute: Attribute,
  value: unknown,
  context: DeserialiseContext,
  where: string,
  result: Deserialised
): Record<string, unknown> {
  const { __component, block, ...data } = (value ?? {}) as Record<string, unknown>
  // By the catalogue id first: it survives a change of the Strapi UID (ADR-0018).
  const uid = (typeof block === 'string' && COMPONENT_OF_BLOCK.get(block)) || __component
  if (typeof uid !== 'string' || !(attribute.components ?? []).includes(uid)) {
    throw invalid(where, `"${String(block ?? __component)}" is not a block of this zone`)
  }
  const attributes = context.componentAttributes(uid)
  if (!attributes) throw invalid(where, `component ${uid} is not registered`)
  return { __component: uid, ...componentOf(attributes, data, context, where, result) }
}

function mediaOf(value: unknown, context: DeserialiseContext, where: string): number | null {
  const sha256 = (value as { media?: unknown } | null)?.media
  if (typeof sha256 !== 'string' || !context.hasMedia(sha256)) {
    throw invalid(where, 'a media reference names a file the archive does not hold')
  }
  return context.fileOf(sha256) ?? null
}

function list(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw invalid(where, 'expected a list')
  return value
}

function expect(valid: boolean, value: unknown, where: string): unknown {
  if (!valid) throw invalid(where, `${JSON.stringify(value)} does not fit the attribute`)
  return value
}

function invalid(where: string, why: string): ExportError {
  return new ExportError('exportDocumentInvalid', `${where}: ${why}`)
}
