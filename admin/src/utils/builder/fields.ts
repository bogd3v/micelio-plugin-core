/** An attribute of a component as the Content Manager's API describes it (`/content-manager/components`). */
export interface ComponentAttribute {
  type: string
  required?: boolean
  repeatable?: boolean
  component?: string
  enum?: string[]
  default?: string
  /** A media attribute: one file or several. */
  multiple?: boolean
  /** A media attribute: `images`, `videos`, `audios` and `files`; empty for any. */
  allowedTypes?: string[]
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

/** A media attribute of the panel: the file or files of a block or an item. */
export interface MediaField {
  name: string
  multiple: boolean
  /** What the Media Library dialog offers; empty offers every file. */
  allowedTypes: string[]
  required: boolean
}

/** What the panel shows for a block. */
export interface BlockFields {
  options: OptionField[]
  text: TextField[]
  /** The media attributes; absent for a component that has none. */
  media?: MediaField[]
  items: ItemsField[]
}

/** A file as the Content Manager populates it: the part of it the panel reads or shows. */
export interface MediaFile {
  id: number
  name?: string
  url?: string
  mime?: string
  /** In kilobytes, as the Media Library stores it. */
  size?: number
  /** `null` until someone writes one; the empty string is a file marked decorative. */
  alternativeText?: string | null
  formats?: { thumbnail?: { url?: string } } | null
}

const TEXT_TYPES = new Set(['string', 'text', 'richtext'])

/** The instance ids of a block and of an item (ADR-0018, section 1): the server writes them, editors never see them. */
const HIDDEN_FIELDS: ReadonlySet<string> = new Set(['blockId', 'itemId'])

/**
 * Sorts the attributes of a component into what the panel edits: options, text and items.
 *
 * @remarks
 * An option is an enumeration the block's contract exposes (`exposed`, with the values the site
 * allows); an enumeration the contract does not expose is left alone, as are relations and
 * every attribute the panel does not edit, the `blockId` and `itemId` instance ids among them. The panel shows only what the host stores, so a value
 * the host's enumeration lacks is never offered.
 *
 * @param exposed - The block's options as the site merges them, `values` by name.
 */
export function fieldsOf(
  schema: ComponentSchema | undefined,
  exposed: Record<string, readonly string[]>
): BlockFields {
  const fields: BlockFields = { options: [], text: [], items: [] }
  const media: MediaField[] = []
  for (const [name, attribute] of Object.entries(schema?.attributes ?? {})) {
    if (HIDDEN_FIELDS.has(name)) continue
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
    } else if (attribute.type === 'media') {
      media.push({
        name,
        multiple: attribute.multiple === true,
        allowedTypes: attribute.allowedTypes ?? [],
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
  if (media.length > 0) fields.media = media
  return fields
}

/**
 * The names of the required text fields, media fields and item lists of a block that are empty.
 *
 * @param skip - Fields to leave out: an island's static alternative is required before the page
 * goes to review (`islandAlternativeMissing`), not to save.
 */
export function missingRequired(
  fields: BlockFields,
  values: Record<string, unknown>,
  skip: readonly string[] = []
): string[] {
  const text = fields.text
    .filter(
      ({ name, required }) =>
        required &&
        !skip.includes(name) &&
        !(typeof values[name] === 'string' && values[name].trim() !== '')
    )
    .map(({ name }) => name)
  const media = (fields.media ?? [])
    .filter(
      ({ name, required }) => required && !skip.includes(name) && filesOf(values, name).length === 0
    )
    .map(({ name }) => name)
  const items = fields.items
    .filter(
      ({ name, required }) => required && !skip.includes(name) && itemsOf(values, name).length === 0
    )
    .map(({ name }) => name)
  return [...text, ...media, ...items]
}

/**
 * Whether a block lacks something its component requires, in itself or in one of its items: the
 * check the builder makes before it saves.
 *
 * @param itemFields - The fields of the item component, by the field that holds the items.
 * @param skip - The block's own fields to leave out (see `missingRequired`).
 */
export function isIncomplete(
  fields: BlockFields,
  itemFields: Record<string, BlockFields>,
  values: Record<string, unknown>,
  skip: readonly string[] = []
): boolean {
  if (missingRequired(fields, values, skip).length > 0) return true
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

/** The files of a media field of a block or an item, in order: none for a field with no file. */
export function filesOf(values: Record<string, unknown>, name: string): MediaFile[] {
  const value = values[name]
  return [value]
    .flat()
    .filter(
      (file): file is MediaFile =>
        typeof file === 'object' && file !== null && typeof (file as MediaFile).id === 'number'
    )
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
