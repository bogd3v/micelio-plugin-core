// The generated JSON Schema of a block, read back as the Strapi attributes that store it. The test
// of the catalogue compares them with the component JSON of `micelio-cms`, and the reference in
// `docs/blocks.md` is written from them.
import { z } from 'zod'
import { blockContentSchema, type Block } from './blocks'
import { ICON_KEYWORD, STRAPI_KEYWORD, type IconDeclaration, type StrapiAnnotation } from './fields'

/** The part of JSON Schema the field builders produce. */
export interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  anyOf?: JsonSchema[]
  enum?: string[]
  default?: unknown
  description?: string
  pattern?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  [STRAPI_KEYWORD]?: StrapiAnnotation
  [ICON_KEYWORD]?: Required<IconDeclaration>
}

/** A Strapi attribute, as a component's JSON declares it. */
export type StrapiAttribute = Record<string, unknown> & { type: string }

/** A component as Strapi declares it, reduced to its attributes. */
export type StrapiAttributes = Record<string, StrapiAttribute>

/** The attributes of a block's component and of every part nested in it, keyed by UID. */
interface StrapiComponents {
  /** The UID of the block's own component. */
  component: string
  /** Every component of the block, its own included. */
  components: Record<string, StrapiAttributes>
}

/** The JSON Schema of a block's content as the content API answers it, `variant` included. */
export function blockJsonSchema(block: Block): JsonSchema {
  const schema = z.toJSONSchema(blockContentSchema(block), { io: 'input' }) as JsonSchema & {
    $schema?: string
  }
  // The dialect is declared once, by the catalogue's schema.
  delete schema.$schema
  return { ...schema, [STRAPI_KEYWORD]: annotationOf(block) }
}

/** The Strapi components a block's JSON Schema describes. */
export function strapiComponents(block: Block): StrapiComponents {
  const components: Record<string, StrapiAttributes> = {}
  collect(block.schema.component, blockJsonSchema(block), components)
  return { component: block.schema.component, components }
}

/** An icon field of a block: where it is and how the block declares it. */
export interface IconField {
  /** From the block's root, a part's fields included: `items[].icon`. */
  path: string
  declaration: Required<IconDeclaration>
}

/** The icon fields of a block (ADR-0021, section 1), in the order of its schema. */
export function iconFieldsOf(block: Block): IconField[] {
  return walk(blockJsonSchema(block), '').flatMap(({ path, schema }) => {
    const declaration = schema[ICON_KEYWORD]
    return declaration ? [{ path, declaration }] : []
  })
}

/**
 * What a block's icon fields break of the rules of ADR-0021 (sections 1 and 3), one sentence each;
 * empty when it keeps them all, as a block without an icon field does when it offers no `iconStyle`
 * and declares no `cost.icons`.
 *
 * @remarks
 * An icon that stands alone needs a required `label` beside it, its accessible name. A block with an
 * icon field offers `iconStyle` (the drawing of all its icons) and declares in `cost.icons` the bytes
 * of the sprite entries its icons add; a block without one does neither.
 */
export function iconIssues(block: Block): string[] {
  const issues: string[] = []
  const fields = walk(blockJsonSchema(block), '').filter(({ schema }) => schema[ICON_KEYWORD])
  for (const { path, schema, parent } of fields) {
    if (!schema[ICON_KEYWORD]?.alone) continue
    const label = parent.properties?.label
    if (!parent.required?.includes('label') || !label || withoutNull(label).type !== 'string') {
      issues.push(`${block.id}: the icon ${path} stands alone and needs a required label beside it`)
    }
  }
  const offers = fields.length > 0
  if (offers !== Boolean(block.options.iconStyle)) {
    issues.push(
      offers
        ? `${block.id}: a block with an icon field offers iconStyle`
        : `${block.id}: iconStyle is offered with no icon field`
    )
  }
  if (offers !== (block.cost.icons !== undefined)) {
    issues.push(
      offers
        ? `${block.id}: a block with an icon field declares cost.icons`
        : `${block.id}: cost.icons is declared with no icon field`
    )
  }
  return issues
}

/** A field of a schema, with its path and the object that holds it. */
interface Located {
  path: string
  schema: JsonSchema
  parent: JsonSchema
}

// Every field of a schema, a part's fields included (`items[].icon`).
function walk(parent: JsonSchema, prefix: string): Located[] {
  return Object.entries(parent.properties ?? {}).flatMap(([name, property]) => {
    const schema = withoutNull(property)
    const path = `${prefix}${name}`
    const inner = schema.items ?? schema
    return [
      { path, schema, parent },
      ...(inner.properties ? walk(inner, `${path}${schema.items ? '[]' : ''}.`) : []),
    ]
  })
}

function annotationOf(block: Block): StrapiAnnotation {
  return { type: 'component', component: block.schema.component, repeatable: false }
}

function collect(uid: string, schema: JsonSchema, into: Record<string, StrapiAttributes>): void {
  const attributes: StrapiAttributes = {}
  const required = new Set(schema.required ?? [])
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const field = withoutNull(property)
    const attribute = attributeOf(field, required.has(name))
    attributes[name] = attribute
    if (attribute.type === 'component') {
      collect(String(attribute.component), field.items ?? field, into)
    }
  }
  into[uid] = attributes
}

function attributeOf(field: JsonSchema, required: boolean): StrapiAttribute {
  const annotation = field[STRAPI_KEYWORD]
  if (!annotation) throw new Error(`a field has no ${STRAPI_KEYWORD} annotation`)
  const attribute: StrapiAttribute = { ...annotation }
  if (annotation.type === 'component' && annotation.repeatable) {
    copy(attribute, { min: field.minItems, max: field.maxItems })
  } else if (annotation.type === 'integer') {
    copy(attribute, { min: field.minimum, max: field.maximum })
  } else if (annotation.type === 'enumeration') {
    copy(attribute, { enum: field.enum })
  } else if (['string', 'text', 'richtext'].includes(annotation.type)) {
    copy(attribute, {
      regex: field.pattern,
      minLength: field.minLength,
      maxLength: field.maxLength,
      description: field.description,
    })
  }
  copy(attribute, { default: field.default, required: required || undefined })
  return attribute
}

// An optional field is `anyOf: [field, { type: 'null' }]`.
function withoutNull(schema: JsonSchema): JsonSchema {
  return schema.anyOf?.find((option) => option.type !== 'null') ?? schema
}

function copy(target: StrapiAttribute, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) if (value !== undefined) target[key] = value
}
