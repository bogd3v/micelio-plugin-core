import { OPTION_NAMES } from '../../../../contract/options'

import type { ComponentSchema } from './fields'

/** The dynamic zone the builder composes: the one the preview protocol addresses. */
export const ZONE = 'sections'

/** One block of the page being built: a component of the page's dynamic zone. */
export interface BuilderBlock {
  /**
   * The id of this block in the builder, stable for the session: it survives a move, an undo and
   * the save that gives a new block its Strapi id. The list, the selection and the history refer to
   * a block by it, never by position.
   */
  key: string
  /** Strapi's id of the component; `undefined` until the first save that stores it. */
  id?: number
  /** The component's UID, such as `section.hero`. */
  component: string
  /** Every other attribute of the component, as the Content Manager's API holds it. */
  fields: Record<string, unknown>
}

/** What a component of a dynamic zone looks like in the Content Manager's API. */
interface RawComponent extends Record<string, unknown> {
  __component: string
  id?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

let counter = 0

/** A new block key; unique within the page session. */
export function newKey(): string {
  counter += 1
  return `b${counter}`
}

/** Reads the dynamic zone of a document into blocks; anything that is not a component is left out. */
export function readBlocks(zone: unknown): BuilderBlock[] {
  if (!Array.isArray(zone)) return []
  return zone.flatMap((raw): BuilderBlock[] => {
    if (!isRecord(raw) || typeof raw.__component !== 'string') return []
    const { __component, id, ...fields } = raw as RawComponent
    return [
      { key: newKey(), ...(typeof id === 'number' ? { id } : {}), component: __component, fields },
    ]
  })
}

/** The zone as `PUT /content-manager/collection-types/…` takes it: a stored block keeps its `id`. */
export function writeBlocks(blocks: BuilderBlock[]): RawComponent[] {
  return blocks.map(({ id, component, fields }) => ({
    ...(id === undefined ? {} : { id }),
    __component: component,
    ...fields,
  }))
}

/**
 * Puts the ids a save answered on the blocks it was made of, matching by position and component:
 * Strapi's numeric `id`, and the `blockId` and `itemId` the server generated.
 *
 * @remarks
 * The builder must hold the instance ids the server made: a block added in the session and moved
 * before the next save would otherwise go out without its `blockId`, and the server would give it a
 * new one. An id the block or item already has is never replaced. Items are matched by position
 * within their block, and only while the block still has as many items as the save sent.
 */
export function adoptIds(
  saved: BuilderBlock[],
  answered: unknown,
  current: BuilderBlock[]
): BuilderBlock[] {
  const raws = new Map<string, Record<string, unknown>>()
  const ids = new Map<string, number>()
  if (Array.isArray(answered)) {
    saved.forEach((block, position) => {
      const raw: unknown = answered[position]
      if (isRecord(raw) && raw.__component === block.component) {
        raws.set(block.key, raw)
        if (typeof raw.id === 'number') ids.set(block.key, raw.id)
      }
    })
  }
  return current.map((block) => {
    const raw = raws.get(block.key)
    if (!raw) return block
    const id = ids.get(block.key)
    const fields = adoptInstanceIds(
      block.fields,
      raw,
      saved.find(({ key }) => key === block.key)?.fields ?? {}
    )
    const withId = id === undefined || block.id !== undefined ? block : { ...block, id }
    return fields === block.fields ? withId : { ...withId, fields }
  })
}

// The `blockId` of the answered block and the `itemId` of its items, where the fields have none.
function adoptInstanceIds(
  fields: Record<string, unknown>,
  raw: Record<string, unknown>,
  sent: Record<string, unknown>
): Record<string, unknown> {
  let next = fields
  const set = (name: string, value: unknown) => {
    if (next === fields) next = { ...fields }
    next[name] = value
  }
  if (typeof raw.blockId === 'string' && !(typeof fields.blockId === 'string' && fields.blockId)) {
    set('blockId', raw.blockId)
  }
  for (const [name, answeredItems] of Object.entries(raw)) {
    const items = fields[name]
    const sentItems = sent[name]
    if (
      !Array.isArray(answeredItems) ||
      !Array.isArray(items) ||
      !Array.isArray(sentItems) ||
      items.length !== sentItems.length ||
      answeredItems.length !== sentItems.length
    ) {
      continue
    }
    const adopted = items.map((item: unknown, index) => {
      const answer: unknown = answeredItems[index]
      if (
        !isRecord(item) ||
        !isRecord(answer) ||
        typeof answer.itemId !== 'string' ||
        (typeof item.itemId === 'string' && item.itemId)
      ) {
        return item
      }
      return { ...item, itemId: answer.itemId }
    })
    if (adopted.some((item, index) => item !== items[index])) set(name, adopted)
  }
  return next
}

/** The blocks with `block` inserted so that it lands at `position` (0 is the top), clamped to the ends. */
export function insertAt(
  blocks: BuilderBlock[],
  position: number,
  block: BuilderBlock
): BuilderBlock[] {
  const at = Math.max(0, Math.min(position, blocks.length))
  return [...blocks.slice(0, at), block, ...blocks.slice(at)]
}

/** The blocks with the one called `key` moved to `position` among the others; unchanged for an unknown key. */
export function moveTo(blocks: BuilderBlock[], key: string, position: number): BuilderBlock[] {
  const from = blocks.findIndex((block) => block.key === key)
  const moving = blocks[from]
  if (!moving) return blocks
  const rest = blocks.filter((block) => block.key !== key)
  return insertAt(rest, position, moving)
}

/** The blocks with the one called `key` moved one place up (`-1`) or down (`1`); unchanged at an end. */
export function moveBy(blocks: BuilderBlock[], key: string, step: -1 | 1): BuilderBlock[] {
  const from = blocks.findIndex((block) => block.key === key)
  const to = from + step
  if (from < 0 || to < 0 || to >= blocks.length) return blocks
  return moveTo(blocks, key, to)
}

/** The blocks without the one called `key`. */
export function removeKey(blocks: BuilderBlock[], key: string): BuilderBlock[] {
  return blocks.filter((block) => block.key !== key)
}

/**
 * A copy of a block for a duplicate: a new key and no Strapi ids, its own or its items', and no
 * `blockId` or `itemId`: the copy is another block, and the server gives it ids of its own. Media
 * and relations keep the id they are made of.
 *
 * @param schemas - The component schemas, by UID: they say which attributes are components.
 */
export function duplicate(block: BuilderBlock, schemas: ComponentSchemas): BuilderBlock {
  return {
    key: newKey(),
    component: block.component,
    fields: withoutInstanceIds(
      cleanFields(block.component, block.fields, undefined, schemas),
      block.component,
      schemas,
      'blockId'
    ),
  }
}

/** The fields of a block without its `blockId`, and without the `itemId` of its items, nested ones too. */
function withoutInstanceIds(
  fields: Record<string, unknown>,
  component: string,
  schemas: ComponentSchemas,
  own: 'blockId' | 'itemId'
): Record<string, unknown> {
  const next = Object.fromEntries(Object.entries(fields).filter(([name]) => name !== own))
  for (const [name, attribute] of Object.entries(schemas[component]?.attributes ?? {})) {
    const inner = attribute.component
    const value = next[name]
    if (attribute.type !== 'component' || !inner || value === undefined || value === null) continue
    const strip = (row: unknown) =>
      isRecord(row) ? withoutInstanceIds(row, inner, schemas, 'itemId') : row
    next[name] = Array.isArray(value) ? value.map(strip) : strip(value)
  }
  return next
}

/** The blocks with `fields` laid over those of the block called `key`. */
export function setFields(
  blocks: BuilderBlock[],
  key: string,
  fields: Record<string, unknown>
): BuilderBlock[] {
  return blocks.map((block) =>
    block.key === key ? { ...block, fields: { ...block.fields, ...fields } } : block
  )
}

/** The ids Strapi holds for the blocks of the zone, for {@link forgetUnknownIds}. */
export function storedIds(blocks: BuilderBlock[]): Set<string> {
  return new Set(blocks.flatMap((block) => (block.id === undefined ? [] : [idOf(block)])))
}

// Strapi numbers the rows of each component on its own, so an id names a block with its component.
const idOf = (block: BuilderBlock): string => `${block.component}:${block.id}`

/**
 * The blocks without the Strapi id of a block that the last save no longer holds, nor the ids of
 * its items.
 *
 * @remarks
 * An undo brings back a block the editor removed: the component was deleted by the save, so the
 * block goes in as a new one, with the same `key`, and so do its items (Strapi refuses an item id
 * the block does not have).
 */
export function forgetUnknownIds(
  blocks: BuilderBlock[],
  known: Set<string>,
  schemas: ComponentSchemas
): BuilderBlock[] {
  return blocks.map((block) => {
    if (block.id === undefined || known.has(idOf(block))) return block
    return {
      key: block.key,
      component: block.component,
      fields: cleanFields(block.component, block.fields, undefined, schemas),
    }
  })
}

/**
 * The block without the presentation options its contract does not expose.
 *
 * @remarks
 * The content API stores a default for every option an enumeration of the component declares,
 * but the CMS refuses a save that names an option the block does not expose
 * (`blockOptionInvalid`). So a block is sent without them; they keep their stored value.
 *
 * @param entries - The site's catalogue; without it the block is sent as it is. A block it
 * does not list is sent without any option.
 */
export function withoutHiddenOptions(
  block: BuilderBlock,
  entries: { component: string; options: Record<string, unknown> }[] | undefined
): BuilderBlock {
  if (!entries) return block
  const entry = entries.find(({ component }) => component === block.component)
  // A block the site disabled has no entry and its panel offers no option: none is sent, and the
  // stored values stay (the CMS refuses an option the block does not expose, also when unchanged).
  const hidden = entry ? OPTION_NAMES.filter((name) => !(name in entry.options)) : OPTION_NAMES
  const fields = Object.fromEntries(
    Object.entries(block.fields).filter(([name]) => !(hidden as readonly string[]).includes(name))
  )
  return { ...block, fields }
}

/**
 * The blocks without the id of an item that the zone the CMS holds no longer has.
 *
 * @remarks
 * Strapi refuses a save that names an item of a repeatable component the document does not have,
 * so an item the other session removed (or the last save, for an undo) goes in as a new one. Only
 * the ids of components go: a file or a relation keeps its id, which is what names it. Blocks
 * absent from `held` are left alone: {@link forgetUnknownIds} gives those new ids.
 */
export function forgetGoneItems(
  blocks: BuilderBlock[],
  held: BuilderBlock[],
  schemas: ComponentSchemas
): BuilderBlock[] {
  return blocks.map((block) => {
    const same = held.find((other) => block.id !== undefined && idOf(other) === idOf(block))
    if (!same) return block
    return { ...block, fields: cleanFields(block.component, block.fields, same.fields, schemas) }
  })
}

/** The component schemas of the catalogue, by UID. */
export type ComponentSchemas = Record<string, ComponentSchema>

/**
 * The fields of a component without the ids of the items that `held` does not have.
 *
 * @param held - The fields as the CMS holds them; `undefined` when nothing of them is held, so
 * every item loses its id.
 */
function cleanFields(
  component: string,
  fields: Record<string, unknown>,
  held: Record<string, unknown> | undefined,
  schemas: ComponentSchemas
): Record<string, unknown> {
  const attributes = schemas[component]?.attributes
  if (!attributes) return fields
  const next = { ...fields }
  for (const [name, attribute] of Object.entries(attributes)) {
    if (attribute.type !== 'component' || !attribute.component) continue
    const inner = attribute.component
    const value = fields[name]
    const heldRows = [held?.[name]].flat().filter(isRecord)
    const clean = (row: unknown): unknown => {
      if (!isRecord(row)) return row
      const same = 'id' in row ? heldRows.find((other) => other.id === row.id) : undefined
      if (same) return cleanFields(inner, row, same, schemas)
      const rest = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id'))
      return cleanFields(inner, rest, undefined, schemas)
    }
    if (Array.isArray(value)) next[name] = value.map(clean)
    else if (value !== undefined && value !== null) next[name] = clean(value)
  }
  return next
}
