/** An attribute of a component as the Content Manager's API describes it (`/content-manager/components`). */
export interface ComponentAttribute {
  type: string
  required?: boolean
  repeatable?: boolean
  component?: string
  enum?: string[]
  default?: string
}

/** A component's schema, reduced to what the panel reads. */
export interface ComponentSchema {
  uid: string
  attributes: Record<string, ComponentAttribute>
}

/** A text field of the panel. */
export interface TextField {
  name: string
  /** `text` and `richtext` take a textarea. */
  multiline: boolean
  required: boolean
}

/** A presentation option of the panel: an enumeration of the host's component the contract exposes. */
export interface OptionField {
  name: string
  /** The values the editor may pick: the contract's, as the site merges them, that the host stores. */
  values: string[]
}

/** A repeatable component of the block: its items open one level down. */
export interface ItemsField {
  name: string
  component: string
  required: boolean
}

/** What the panel shows for a block. */
export interface BlockFields {
  options: OptionField[]
  text: TextField[]
  items: ItemsField[]
}

const TEXT_TYPES = new Set(['string', 'text', 'richtext'])

/**
 * Sorts the attributes of a component into what the panel edits: options, text and items.
 *
 * @remarks
 * An option is an enumeration the block's contract exposes (`exposed`, with the values the site
 * allows); an enumeration the contract does not expose is left alone, as are media, relations and
 * every attribute the panel does not edit. The panel shows only what the host stores, so a value
 * the host's enumeration lacks is never offered.
 *
 * @param exposed - The block's options as the site merges them, `values` by name.
 */
export function fieldsOf(
  schema: ComponentSchema | undefined,
  exposed: Record<string, readonly string[]>
): BlockFields {
  const fields: BlockFields = { options: [], text: [], items: [] }
  for (const [name, attribute] of Object.entries(schema?.attributes ?? {})) {
    if (attribute.type === 'enumeration') {
      const offered = exposed[name]
      if (!offered) continue
      const values = offered.filter((value) => attribute.enum?.includes(value))
      if (values.length > 0) fields.options.push({ name, values })
    } else if (TEXT_TYPES.has(attribute.type)) {
      fields.text.push({
        name,
        multiline: attribute.type !== 'string',
        required: attribute.required === true,
      })
    } else if (attribute.type === 'component' && attribute.repeatable && attribute.component) {
      fields.items.push({
        name,
        component: attribute.component,
        required: attribute.required === true,
      })
    }
  }
  return fields
}

/** The names of the required text fields and required item lists of a block that are empty. */
export function missingRequired(fields: BlockFields, values: Record<string, unknown>): string[] {
  const text = fields.text
    .filter(
      ({ name, required }) =>
        required && !(typeof values[name] === 'string' && values[name].trim() !== '')
    )
    .map(({ name }) => name)
  const items = fields.items
    .filter(({ name, required }) => required && itemsOf(values, name).length === 0)
    .map(({ name }) => name)
  return [...text, ...items]
}

/**
 * Whether a block lacks something its component requires, in itself or in one of its items: the
 * check the builder makes before it saves.
 *
 * @param itemFields - The fields of the item component, by the field that holds the items.
 */
export function isIncomplete(
  fields: BlockFields,
  itemFields: Record<string, BlockFields>,
  values: Record<string, unknown>
): boolean {
  if (missingRequired(fields, values).length > 0) return true
  return fields.items.some(({ name }) => {
    const inner = itemFields[name]
    return (
      inner !== undefined &&
      itemsOf(values, name).some((item) => missingRequired(inner, item).length > 0)
    )
  })
}

/** The items of a repeatable field of a block, in order. */
export function itemsOf(values: Record<string, unknown>, name: string): Record<string, unknown>[] {
  const list = values[name]
  return Array.isArray(list)
    ? list.filter(
        (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
      )
    : []
}

/** What a new block starts with: the site's default of each option the host stores. */
export function startingFields(
  schema: ComponentSchema | undefined,
  defaults: Record<string, string>
): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const [name, attribute] of Object.entries(schema?.attributes ?? {})) {
    const value = defaults[name]
    if (
      attribute.type === 'enumeration' &&
      value !== undefined &&
      attribute.enum?.includes(value)
    ) {
      fields[name] = value
    }
  }
  return fields
}
