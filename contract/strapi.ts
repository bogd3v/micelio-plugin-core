// The generated JSON Schema of a block, read back as the Strapi attributes that store it. The test
// of the catalogue compares them with the component JSON of `micelio-cms`, and the reference in
// `docs/blocks.md` is written from them.
import { z } from 'zod'
import { blockContentSchema, type Block } from './blocks'
import { STRAPI_KEYWORD, type StrapiAnnotation } from './fields'

/** The part of JSON Schema the field builders produce. */
interface JsonSchema {
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
