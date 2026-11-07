import { BLOCKS, optionsOf, type Block } from '../../../contract/blocks'
import { OPTION_NAMES } from '../../../contract/options'
import type {
  TemplateBlock,
  TemplateContent,
  TemplateDocument,
  ThumbnailShape,
} from '../types/page-templates'
import {
  TEMPLATE_DESCRIPTION_MAX_LENGTH,
  TEMPLATE_NAME_MAX_LENGTH,
} from '../constants/page-templates'

/** An attribute of a component, as Strapi stores it: the part a template reads. */
export interface ComponentAttribute {
  type?: string
  component?: string
  repeatable?: boolean
}

/** The attributes of a component by UID; `undefined` for a component Strapi does not know. */
export type AttributesOf = (component: string) => Record<string, ComponentAttribute> | undefined

type Row = Record<string, unknown>

const isRecord = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const TEXT_TYPES = new Set(['string', 'text', 'richtext'])
const KEPT_TYPES = new Set(['enumeration', 'boolean', 'integer'])

/** A field that holds an address: a template never keeps one (its link, its credit's source). */
const isLinkField = (name: string) => name === 'url' || name.endsWith('Url')

/** A part that is a link: a template never keeps one. */
const isLinkComponent = (component: string | undefined) =>
  component !== undefined && component.endsWith('.link')

/** The catalogue block whose component is `component`. */
export function blockOfComponent(component: string): Block | undefined {
  return BLOCKS.find((block) => block.schema.component === component)
}

/**
 * The names of the vocabulary's options a block does not expose, which its component may declare
 * all the same: the catalogue refuses them, so a template never keeps one.
 */
export function unexposedOptions(component: string): ReadonlySet<string> {
  const block = blockOfComponent(component)
  const exposed = new Set(block ? optionsOf(block).map(([name]) => name) : [])
  return new Set(['variant', ...OPTION_NAMES].filter((name) => block && !exposed.has(name)))
}

/**
 * What a template keeps of a block's stored content: its options and settings, and the text when
 * `content` is `sample`; the items stay (empty when `clear`), a file or a link never does.
 *
 * @remarks
 * It reads the component's attributes, so what is not an attribute of the component is dropped, and
 * applying it to its own result changes nothing.
 */
export function shapeContent(
  attributesOf: AttributesOf,
  component: string,
  stored: unknown,
  content: TemplateContent
): Row {
  const entry = isRecord(stored) ? stored : {}
  const kept: Row = {}
  const unexposed = unexposedOptions(component)
  for (const [name, attribute] of Object.entries(attributesOf(component) ?? {})) {
    const value = entry[name]
    if (value === undefined || value === null || unexposed.has(name)) continue
    const type = attribute.type ?? ''
    if (KEPT_TYPES.has(type)) {
      kept[name] = value
    } else if (TEXT_TYPES.has(type)) {
      if (content === 'sample' && typeof value === 'string' && value.trim() !== '') {
        if (!isLinkField(name)) kept[name] = value
      }
    } else if (
      type === 'component' &&
      attribute.component &&
      !isLinkComponent(attribute.component)
    ) {
      if (attribute.repeatable) {
        if (Array.isArray(value) && value.length > 0) {
          kept[name] = value.map((item) =>
            shapeContent(attributesOf, attribute.component as string, item, content)
          )
        }
      } else {
        const nested = shapeContent(attributesOf, attribute.component, value, content)
        if (Object.keys(nested).length > 0) kept[name] = nested
      }
    }
  }
  return kept
}

/**
 * The entry of a block's component without the options its catalogue entry does not expose.
 *
 * @remarks
 * The document service stores a default for every option a component declares, and the catalogue
 * refuses a write that names one the block does not expose (`blockOptionInvalid`), so a block read
 * from a draft goes back in without them; they keep their stored value.
 */
export function withoutUnexposed(entry: Row): Row {
  const hidden = unexposedOptions(String(entry.__component))
  return Object.fromEntries(Object.entries(entry).filter(([name]) => !hidden.has(name)))
}

/** Every text a block's stored content holds, nested items included. */
export function textsOf(attributesOf: AttributesOf, component: string, stored: unknown): string[] {
  const entry = isRecord(stored) ? stored : {}
  return Object.entries(attributesOf(component) ?? {}).flatMap(([name, attribute]) => {
    const value = entry[name]
    if (TEXT_TYPES.has(attribute.type ?? '')) {
      return typeof value === 'string' && value.trim() !== '' ? [value.trim()] : []
    }
    if (attribute.type === 'component' && attribute.component) {
      const nested = attribute.repeatable ? value : [value]
      return Array.isArray(nested)
        ? nested.flatMap((item) => textsOf(attributesOf, attribute.component as string, item))
        : []
    }
    return []
  })
}

/** The sample texts a page copies from a template: the text of every block that kept it. */
export function samplesOf(attributesOf: AttributesOf, blocks: readonly TemplateBlock[]): string[] {
  const texts = blocks
    .filter((block) => block.content === 'sample')
    .flatMap((block) => textsOf(attributesOf, block.component, block.data))
  return [...new Set(texts)]
}

/** A block of a page's draft that still holds the sample text of its template. */
export interface SampleTextFound {
  /** The `id` of the block in the catalogue, or its component when it is not one. */
  block: string
  /** Its place in the zone, from 0. */
  position: number
  /** The fields that hold a sample text. */
  fields: string[]
}

/**
 * Finds the blocks of a dynamic zone that still hold a sample text of the template, a text
 * the editor has not replaced.
 *
 * @param zone - The entries of the zone, each with its `__component`.
 * @param samples - The sample texts the page recorded when it was created.
 */
export function findSampleText(
  attributesOf: AttributesOf,
  zone: readonly unknown[],
  samples: readonly string[]
): SampleTextFound[] {
  if (samples.length === 0) return []
  const wanted = new Set(samples)
  const fieldsIn = (component: string, entry: unknown, prefix = ''): string[] => {
    const row = isRecord(entry) ? entry : {}
    return Object.entries(attributesOf(component) ?? {}).flatMap(([name, attribute]) => {
      const value = row[name]
      if (TEXT_TYPES.has(attribute.type ?? '')) {
        return typeof value === 'string' && wanted.has(value.trim()) ? [`${prefix}${name}`] : []
      }
      if (attribute.type === 'component' && attribute.component) {
        const items = attribute.repeatable ? value : [value]
        return Array.isArray(items)
          ? items.flatMap((item, index) =>
              fieldsIn(
                attribute.component as string,
                item,
                `${prefix}${name}${attribute.repeatable ? `[${index + 1}]` : ''}.`
              )
            )
          : []
      }
      return []
    })
  }
  return zone.flatMap((entry, position) => {
    if (!isRecord(entry) || typeof entry.__component !== 'string') return []
    const fields = fieldsIn(entry.__component, entry)
    if (fields.length === 0) return []
    return [
      { block: blockOfComponent(entry.__component)?.id ?? entry.__component, position, fields },
    ]
  })
}

/** What the blocks add to a page before any content, in kB with one decimal. */
export function costKbOf(blocks: readonly Pick<TemplateBlock, 'block'>[]): number {
  const bytes = blocks.reduce((sum, { block }) => {
    const entry = BLOCKS.find((candidate) => candidate.id === block)
    return sum + (entry ? entry.cost.css + entry.cost.js : 0)
  }, 0)
  return Math.round((bytes / 1024) * 10) / 10
}

const SHAPES: Record<string, ThumbnailShape> = {
  hero: 'hero',
  'feature-grid': 'cards',
  stats: 'cards',
  testimonials: 'cards',
  pricing: 'cards',
  faq: 'list',
  'post-list': 'list',
  'logo-cloud': 'row',
  'media-showcase': 'media',
  gallery: 'media',
  scene: 'media',
  slider: 'media',
  media: 'media',
  cta: 'cta',
  newsletter: 'cta',
}

/** The thumbnail of a template: one shape for each block, which the card draws. The structure, never an image of the page. */
export function thumbnailOf(blocks: readonly Pick<TemplateBlock, 'block'>[]): ThumbnailShape[] {
  return blocks.map(({ block }) => SHAPES[block] ?? 'text')
}

/** The options of a template block, by name, as the cards and the dialog list them. */
export function optionsSummary(block: TemplateBlock): Record<string, string> {
  const entry = BLOCKS.find((candidate) => candidate.id === block.block)
  const names = new Set(['variant', ...Object.keys(entry?.options ?? {})])
  return Object.fromEntries(
    Object.entries(block.data).flatMap(([name, value]) =>
      names.has(name) && (typeof value === 'string' || typeof value === 'number')
        ? [[name, String(value)]]
        : []
    )
  )
}

/** The slug a title makes: lowercase letters and digits joined by dashes; `page` when it has none. */
export function slugOf(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug === '' ? 'page' : slug
}

/** Why a document is not a template. */
export interface TemplateDocumentError {
  field: string
  detail: string
}

/**
 * Reads the JSON of an exported template, refusing what is not one.
 *
 * @remarks
 * What a block holds is shaped again through the component's attributes, so a document cannot
 * carry anything a template does not keep; the block's component is the catalogue's, whatever the
 * document says.
 */
export function parseTemplateDocument(
  raw: unknown,
  attributesOf: AttributesOf,
  format: number
): TemplateDocument | TemplateDocumentError {
  const fail = (field: string, detail: string): TemplateDocumentError => ({ field, detail })
  if (!isRecord(raw)) return fail('body', 'A template is a JSON object')
  if (raw.format !== format) return fail('format', `This reads format ${format} of a template`)
  const { name, description, pageTypes, scope, origin, version, blocks } = raw
  if (typeof name !== 'string' || name.trim() === '' || name.length > TEMPLATE_NAME_MAX_LENGTH) {
    return fail('name', `A template needs a name of 1 to ${TEMPLATE_NAME_MAX_LENGTH} characters`)
  }
  if (typeof description !== 'string' || description.length > TEMPLATE_DESCRIPTION_MAX_LENGTH) {
    return fail(
      'description',
      `The description is a text of at most ${TEMPLATE_DESCRIPTION_MAX_LENGTH} characters`
    )
  }
  if (
    !Array.isArray(pageTypes) ||
    !pageTypes.every((type) => typeof type === 'string' && type !== '')
  ) {
    return fail('pageTypes', 'pageTypes is a list of page types')
  }
  if (scope !== 'site' && scope !== 'cms') return fail('scope', 'scope is "site" or "cms"')
  if (origin !== 'site') return fail('origin', 'Only a template made on a site is read')
  if (!Number.isInteger(version) || (version as number) < 1) {
    return fail('version', 'version is a whole number from 1')
  }
  const read = parseTemplateBlocks(blocks, attributesOf)
  if ('field' in read) return read
  return {
    format,
    name: name.trim(),
    description,
    pageTypes: pageTypes as string[],
    scope,
    origin,
    version: version as number,
    blocks: read,
  }
}

/**
 * Reads the blocks of a template, from a document or from the builder, refusing what is not one.
 *
 * @remarks
 * What a block holds is shaped again through the component's attributes, and its component is the
 * catalogue's, whatever the input says.
 */
export function parseTemplateBlocks(
  blocks: unknown,
  attributesOf: AttributesOf
): TemplateBlock[] | TemplateDocumentError {
  const fail = (detail: string): TemplateDocumentError => ({ field: 'blocks', detail })
  if (!Array.isArray(blocks) || blocks.length === 0) return fail('A template has a block')
  const read: TemplateBlock[] = []
  for (const [position, entry] of blocks.entries()) {
    if (!isRecord(entry)) return fail(`Block ${position + 1} is not an object`)
    const block = BLOCKS.find((candidate) => candidate.id === entry.block)
    if (!block) return fail(`The catalogue has no block "${String(entry.block)}"`)
    if (entry.content !== 'sample' && entry.content !== 'clear') {
      return fail(`Block ${position + 1} keeps "sample" or "clear"`)
    }
    if (typeof entry.fixed !== 'boolean') return fail(`Block ${position + 1} is fixed or not`)
    read.push({
      block: block.id,
      component: block.schema.component,
      content: entry.content,
      fixed: entry.fixed,
      data: shapeContent(attributesOf, block.schema.component, entry.data, entry.content),
    })
  }
  return read
}
