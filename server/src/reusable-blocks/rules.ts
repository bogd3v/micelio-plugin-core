// The rules of a reusable block (ADR-0022, section 1) as pure functions of the schemas and of the
// data of a save: no Strapi import.
import { BLOCKS } from '../../../contract/blocks'
import { GROUP_KEY, REUSABLE_BLOCK_UID } from '../constants/reusable-blocks'

/** A schema as these rules read it: a content type's or a component's. */
export interface SchemaOf {
  attributes?: Record<string, { type?: string; target?: string; components?: string[] }>
  pluginOptions?: object
}

/**
 * Where a type of the host references reusable blocks: a component of one of its dynamic zones
 * with a relation to `plugin::micelio.reusable-block`.
 */
export interface ReferenceField {
  /** The UID of the content type: a host's page type, or the core's after the cut-over. */
  uid: string
  /** Its dynamic zone, such as `sections`. */
  zone: string
  /** The component of the zone, such as `section.reusable`. */
  component: string
  /** The relation of the component, such as `reusableBlock`. */
  attribute: string
}

/** Why the block of a reusable block is refused. */
export interface ReusableBlockViolation {
  /** `count`: more than one block; `reference`: a reference to a reusable block; `group`: a `group` key. */
  reason: 'count' | 'reference' | 'group'
  /** The number of blocks, for `count`. */
  count?: number
  /** The component of the refused block, for `reference` and `group`. */
  component?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The relations of each component that target `plugin::micelio.reusable-block`, by component UID. */
export function referenceAttributesOf(components: Record<string, SchemaOf>): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const [uid, schema] of Object.entries(components)) {
    const names = Object.entries(schema.attributes ?? {})
      .filter(([, attribute]) => attribute.type === 'relation')
      .filter(([, attribute]) => attribute.target === REUSABLE_BLOCK_UID)
      .map(([name]) => name)
    if (names.length > 0) found.set(uid, names)
  }
  return found
}

/**
 * Every field of the given content types that references reusable blocks, from their schemas: the
 * lookup never names a page type, so it holds for any type that has such a zone.
 *
 * @param isIncluded - Which content types to read (the site-scoped ones).
 */
export function referenceFieldsOf(
  contentTypes: Record<string, SchemaOf>,
  components: Record<string, SchemaOf>,
  isIncluded: (schema: SchemaOf) => boolean
): ReferenceField[] {
  const references = referenceAttributesOf(components)
  const fields: ReferenceField[] = []
  for (const [uid, schema] of Object.entries(contentTypes)) {
    if (uid === REUSABLE_BLOCK_UID || !isIncluded(schema)) continue
    for (const [zone, attribute] of Object.entries(schema.attributes ?? {})) {
      if (attribute.type !== 'dynamiczone') continue
      for (const component of attribute.components ?? []) {
        for (const name of references.get(component) ?? []) {
          fields.push({ uid, zone, component, attribute: name })
        }
      }
    }
  }
  return fields
}

/**
 * The components a reusable block may hold: the page blocks of the catalogue that the host
 * registers, never one that references a reusable block.
 */
export function zoneComponentsOf(components: Record<string, SchemaOf>): string[] {
  const references = referenceAttributesOf(components)
  return BLOCKS.filter((block) => block.group !== 'article')
    .map((block) => block.schema.component)
    .filter((uid) => uid in components && !references.has(uid))
}

/**
 * The first reason the zone of a reusable block is refused: more than one block, a block that
 * references a reusable block, or a block that carries a `group` key. `undefined` when none.
 *
 * @remarks
 * An empty zone passes: a draft may have no block yet, and Strapi's `min` refuses the publish.
 */
export function findReusableBlockViolation(
  zone: readonly unknown[],
  isReference: (component: string) => boolean
): ReusableBlockViolation | undefined {
  if (zone.length > 1) return { reason: 'count', count: zone.length }
  for (const item of zone) {
    if (!isRecord(item)) continue
    const component = typeof item.__component === 'string' ? item.__component : ''
    if (isReference(component)) return { reason: 'reference', component }
    if (item[GROUP_KEY] !== undefined && item[GROUP_KEY] !== null) {
      return { reason: 'group', component }
    }
  }
  return undefined
}

/** The values of the relations to reusable blocks in the items of a dynamic zone, as the data holds them. */
export function referenceValuesIn(
  zone: readonly unknown[],
  references: ReadonlyMap<string, readonly string[]>
): unknown[] {
  return zone.flatMap((item) => {
    if (!isRecord(item) || typeof item.__component !== 'string') return []
    return (references.get(item.__component) ?? []).flatMap((name) =>
      item[name] === undefined || item[name] === null ? [] : [item[name]]
    )
  })
}
