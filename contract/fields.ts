// The field builders of a block's `schema` (ADR-0018, section 1). Each one is a zod schema of the
// field as the content API answers it, annotated with what JSON Schema cannot say about the Strapi
// attribute that stores it. `docs/blocks.md` describes the mapping.
import { z } from 'zod'
import { ICON_FIELD } from './icons'

/** What JSON Schema does not say about a Strapi attribute: the `x-strapi` keyword of a field. */
export type StrapiAnnotation =
  | { type: 'string' | 'text' | 'richtext' | 'integer' | 'boolean' | 'enumeration' }
  | { type: 'media'; multiple: boolean; allowedTypes: readonly MediaType[] }
  | { type: 'relation'; relation: 'oneToOne'; target: string }
  | { type: 'component'; component: string; repeatable: boolean }
  | { type: 'customField'; customField: typeof ICON_FIELD }

/** A kind of file a media field accepts, as Strapi names it. */
type MediaType = 'images' | 'videos' | 'files'

/** A field of a block or of a part: a zod schema, made by the builders of this file. */
type Field = z.ZodType

/** A part: a nested component, which exists only inside the `schema` of a block. */
export interface Part<Shape extends z.ZodRawShape = z.ZodRawShape> {
  /** The Strapi UID of the component that stores it (`section.link`). */
  component: string
  fields: z.ZodObject<Shape>
}

interface Presence {
  /** @defaultValue false */
  required?: boolean
}

interface TextOptions extends Presence {
  minLength?: number
  maxLength?: number
  /** A pattern as Strapi stores it, without delimiters. */
  regex?: string
  /** The help text of the field in the Content Manager. */
  description?: string
}

interface CountOptions extends Presence {
  min?: number
  max?: number
}

/** The keyword that carries a field's {@link StrapiAnnotation} in the generated JSON Schema. */
export const STRAPI_KEYWORD = 'x-strapi'

/**
 * How a block declares an icon field (ADR-0021, section 1): `icon: { required: boolean }`. An icon
 * beside text is decorative; one that stands alone, with no text beside it, is named by a `label`
 * its part requires ({@link iconFields}).
 */
export interface IconDeclaration {
  /** An icon is never required on an existing block (ADR-0021, section 6). */
  required: boolean
  /**
   * `true` when the icon stands alone (a social link, an icon-only button): the part then requires
   * a `label`, the icon's accessible name. Decorative, beside text, when absent.
   *
   * @defaultValue false
   */
  alone?: boolean
}

/** The keyword that carries an icon field's {@link IconDeclaration} in the generated JSON Schema. */
export const ICON_KEYWORD = 'x-micelio-icon'

/** A short text: Strapi's `string`. */
export function string(options: TextOptions = {}): Field {
  return presence(textSchema(options).meta({ [STRAPI_KEYWORD]: { type: 'string' } }), options)
}

/** A long plain text: Strapi's `text`. */
export function text(options: TextOptions = {}): Field {
  return presence(textSchema(options).meta({ [STRAPI_KEYWORD]: { type: 'text' } }), options)
}

/** Markdown, rendered and sanitized by the frontend: Strapi's `richtext`. */
export function richtext(options: TextOptions = {}): Field {
  const schema = textSchema(options).meta({
    [STRAPI_KEYWORD]: { type: 'richtext' },
    contentMediaType: 'text/markdown',
  })
  return presence(schema, options)
}

/** A whole number: Strapi's `integer`. */
export function integer(options: CountOptions & { default?: number } = {}): Field {
  let schema = z.int()
  if (options.min !== undefined) schema = schema.min(options.min)
  if (options.max !== undefined) schema = schema.max(options.max)
  return presence(
    schema.meta({ [STRAPI_KEYWORD]: { type: 'integer' }, ...defaultOf(options.default) }),
    options
  )
}

/** Yes or no: Strapi's `boolean`. */
export function boolean(options: Presence & { default?: boolean } = {}): Field {
  return presence(
    z.boolean().meta({ [STRAPI_KEYWORD]: { type: 'boolean' }, ...defaultOf(options.default) }),
    options
  )
}

/** One of a closed list of stored values: Strapi's `enumeration`. */
export function enumeration(
  values: readonly [string, ...string[]],
  options: Presence & { default?: string } = {}
): Field {
  return presence(
    z
      .enum(values)
      .meta({ [STRAPI_KEYWORD]: { type: 'enumeration' }, ...defaultOf(options.default) }),
    options
  )
}

/** One file of the media library, or several when `multiple`: Strapi's `media`. */
export function media(
  allowedTypes: readonly MediaType[],
  options: Presence & { multiple?: boolean } = {}
): Field {
  const multiple = options.multiple ?? false
  const annotation = { [STRAPI_KEYWORD]: { type: 'media', multiple, allowedTypes } }
  const schema = multiple ? z.array(mediaFile()).meta(annotation) : mediaFile().meta(annotation)
  return presence(schema, options)
}

/** A link to one entry of another content type: a Strapi `oneToOne` relation. */
export function relation(target: string): Field {
  const schema = z
    .looseObject({ documentId: z.string() })
    .meta({ [STRAPI_KEYWORD]: { type: 'relation', relation: 'oneToOne', target } })
  return presence(schema, {})
}

/** One part, or a list of them when `repeatable`: a Strapi `component` attribute. */
export function component(
  part: Part,
  options: CountOptions & { repeatable?: boolean } = {}
): Field {
  const annotation = {
    [STRAPI_KEYWORD]: {
      type: 'component',
      component: part.component,
      repeatable: options.repeatable ?? false,
    },
  }
  if (!options.repeatable) return presence(part.fields.meta(annotation), options)
  let list = z.array(part.fields)
  if (options.min !== undefined) list = list.min(options.min)
  if (options.max !== undefined) list = list.max(options.max)
  return presence(list.meta(annotation), options)
}

/**
 * A name of the icon catalogue (`contract/icons.ts`, ADR-0021): the custom field `micelio.icon`
 * (`plugin::micelio.icon`), a string. The save checks the name against the pinned set
 * (`iconInvalid`); the block's `iconStyle` option says how it is drawn. Use {@link iconFields} in a
 * part, so an icon that stands alone gets its `label`.
 */
export function icon(declaration: IconDeclaration): Field {
  const schema = z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .describe(
      'A name of the icon catalogue (icons.schema.json), drawn in the iconStyle of the block' +
        (declaration.alone ? '; it stands alone, and the label is its accessible name' : '')
    )
    .meta({
      [STRAPI_KEYWORD]: { type: 'customField', customField: ICON_FIELD },
      [ICON_KEYWORD]: { required: declaration.required, alone: declaration.alone ?? false },
    })
  return presence(schema, declaration)
}

/**
 * The fields an icon adds to a part: `icon`, and when it stands alone a required `label`, its
 * accessible name (ADR-0021, section 1). Spread it into the part's shape after the fields it
 * replaces, so a `label` of the part cannot make the name optional.
 */
export function iconFields(declaration: IconDeclaration): Record<string, Field> {
  return {
    icon: icon(declaration),
    ...(declaration.alone ? { label: string({ required: true }) } : {}),
  }
}

/** A nested component, from its Strapi UID and its fields. */
export function part<Shape extends z.ZodRawShape>(uid: string, shape: Shape): Part<Shape> {
  return { component: uid, fields: z.object(shape) }
}

// The content API answers an empty optional field as `null`.
function presence(schema: z.ZodType, { required }: Presence): Field {
  return required ? schema : schema.nullable().optional()
}

function textSchema({ minLength, maxLength, regex, description }: TextOptions): z.ZodString {
  let schema = z.string()
  if (minLength !== undefined) schema = schema.min(minLength)
  if (maxLength !== undefined) schema = schema.max(maxLength)
  if (regex !== undefined) schema = schema.regex(new RegExp(regex))
  return description === undefined ? schema : schema.describe(description)
}

// Strapi fills the default in when an entry is created; the field stays optional for the client.
function defaultOf(value: unknown): { default?: unknown } {
  return value === undefined ? {} : { default: value }
}

// The fields of an uploaded file the frontend reads; the content API sends more.
function mediaFile(): z.ZodType {
  return z.looseObject({ url: z.string(), mime: z.string() })
}
