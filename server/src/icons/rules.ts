import { resolveIconName, type IconCatalogue } from '../../../contract/icons'
import { ICON_FIELD } from '../constants/icons'

/** The part of an attribute these rules read. */
interface Attribute {
  type?: string
  customField?: string
  component?: string
  repeatable?: boolean
}

type Attributes = Record<string, Attribute>

/** A value that is not an icon of the catalogue, and where it was written. */
export interface IconViolation {
  /** The attribute that holds it: `icon`. */
  field: string
  /** Where, from the root of the data: `sections.1.items.0.icon`. */
  path: string
  /** What was written. */
  value: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The first value of a field `micelio.icon` in `data` that is not a name of the pinned catalogue or
 * one of its aliases, or `undefined` when every value is one (or none).
 *
 * @remarks
 * Pure. It walks the attributes of the type, the components and the blocks of its dynamic zones,
 * and reads only what `data` names. `null` is the empty state and is accepted, `undefined` is an
 * attribute the save does not touch; anything else (an empty string included) must resolve through
 * {@link resolveIconName}. A stored alias is accepted as written: the field never rewrites it.
 *
 * @param componentAttributes - The attributes of a component, by UID.
 * @param catalogue - The names and aliases a value may be.
 */
export function findIconViolation(
  attributes: Attributes,
  data: Record<string, unknown>,
  componentAttributes: (uid: string) => Attributes | undefined,
  catalogue: Pick<IconCatalogue, 'names' | 'aliases'>,
  prefix = ''
): IconViolation | undefined {
  for (const [name, attribute] of Object.entries(attributes)) {
    const value = data[name]
    if (value === undefined) continue
    const path = `${prefix}${name}`
    if (attribute.customField === ICON_FIELD) {
      if (value === null) continue
      if (typeof value !== 'string' || resolveIconName(value, catalogue) === undefined) {
        return { field: name, path, value }
      }
    } else if (attribute.type === 'component' && attribute.component) {
      const inner = componentAttributes(attribute.component)
      const entries = Array.isArray(value) ? value : [value]
      for (const [index, entry] of entries.entries()) {
        if (!inner || !isRecord(entry)) continue
        const at = Array.isArray(value) ? `${path}.${index}.` : `${path}.`
        const found = findIconViolation(inner, entry, componentAttributes, catalogue, at)
        if (found) return found
      }
    } else if (attribute.type === 'dynamiczone' && Array.isArray(value)) {
      for (const [index, entry] of value.entries()) {
        if (!isRecord(entry) || typeof entry.__component !== 'string') continue
        const inner = componentAttributes(entry.__component)
        if (!inner) continue
        const found = findIconViolation(
          inner,
          entry,
          componentAttributes,
          catalogue,
          `${path}.${index}.`
        )
        if (found) return found
      }
    }
  }
  return undefined
}
