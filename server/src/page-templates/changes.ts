import { BLOCKS } from '../../../contract/blocks'
import type {
  FixedMark,
  TemplateBlock,
  TemplateChange,
  TemplateSwitchPlan,
} from '../types/page-templates'
import { blockOfComponent, withoutUnexposed } from './rules'

type Row = Record<string, unknown>

/** A block of a sequence with the place that names it: the `nth` block of its catalogue id. */
interface Keyed<T> {
  item: T
  block: string
  nth: number
  key: string
  index: number
}

/**
 * Names each block of a sequence by its catalogue id and how many of that id came before it, so a
 * template and a page made from it can be matched without any id the page does not keep.
 */
function keyedBy<T>(items: readonly T[], blockOf: (item: T) => string | undefined): Keyed<T>[] {
  const seen = new Map<string, number>()
  return items.flatMap((item, index) => {
    const block = blockOf(item)
    if (block === undefined) return []
    const nth = (seen.get(block) ?? 0) + 1
    seen.set(block, nth)
    return [{ item, block, nth, key: `${block}#${nth}`, index }]
  })
}

const ofTemplate = (blocks: readonly TemplateBlock[]) => keyedBy(blocks, ({ block }) => block)
const ofPage = (zone: readonly Row[]) =>
  keyedBy(zone, (entry) => blockOfComponent(String(entry.__component))?.id)

const scalar = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined

/** The names of the options of a block: `variant` and those its catalogue entry exposes. */
function optionNamesOf(block: string): string[] {
  return ['variant', ...Object.keys(BLOCKS.find((entry) => entry.id === block)?.options ?? {})]
}

/**
 * What changed between two versions of a template: the blocks added and removed, the blocks fixed
 * or no longer fixed, and the options whose value moved.
 *
 * @remarks
 * A block of one version is the same block in the other when it is the same catalogue block and the
 * same occurrence of it (the second Hero is the second Hero). Text is not compared: a template's
 * sample text is a hint, not a rule.
 */
export function diffTemplates(
  before: readonly TemplateBlock[],
  after: readonly TemplateBlock[]
): TemplateChange[] {
  const old = new Map(ofTemplate(before).map((entry) => [entry.key, entry.item]))
  const current = ofTemplate(after)
  const present = new Set(current.map(({ key }) => key))
  const changes: TemplateChange[] = []
  for (const entry of current) {
    const was = old.get(entry.key)
    if (!was) {
      changes.push({
        kind: 'added',
        block: entry.block,
        after: current[current.indexOf(entry) - 1]?.block ?? null,
      })
      continue
    }
    if (was.fixed !== entry.item.fixed) {
      changes.push({ kind: entry.item.fixed ? 'fixed' : 'unfixed', block: entry.block })
    }
    for (const option of optionNamesOf(entry.block)) {
      const from = scalar(was.data[option])
      const to = scalar(entry.item.data[option])
      if (from !== undefined && to !== undefined && from !== to) {
        changes.push({ kind: 'option', block: entry.block, option, from, to })
      }
    }
  }
  for (const entry of ofTemplate(before)) {
    if (!present.has(entry.key)) changes.push({ kind: 'removed', block: entry.block })
  }
  return changes
}

/** What applying the structure changes of a template does to a page's zone. */
export interface OfferResult {
  zone: Row[]
  fixed: FixedMark[]
  /** The blocks of the template the page did not have, which now hold their sample text. */
  added: TemplateBlock[]
}

/**
 * Applies what changed in a template to the zone of a page made from an older version of it.
 *
 * @remarks
 * It adds the blocks the page does not hold, after the block that precedes them in the template; it
 * moves an option to the template's new value only where the page still holds the old one, so an
 * option the editor changed stays; and it makes the fixed marks follow the template. It never
 * removes a block and never touches a text the editor wrote. The entries are copied, not mutated.
 *
 * @param zone - The page's blocks, as the document service reads them.
 * @param base - The template as it was when the page started from it.
 * @param current - The template now.
 */
export function applyOffer(
  zone: readonly Row[],
  fixed: readonly FixedMark[],
  base: readonly TemplateBlock[],
  current: readonly TemplateBlock[]
): OfferResult {
  const next = zone.map(withoutUnexposed)
  const was = new Map(ofTemplate(base).map((entry) => [entry.key, entry.item]))
  const now = ofTemplate(current)

  for (const entry of ofPage(next)) {
    const wanted = now.find(({ key }) => key === entry.key)
    const before = was.get(entry.key)
    if (!wanted || !before) continue
    for (const option of optionNamesOf(entry.block)) {
      const from = scalar(before.data[option])
      const to = scalar(wanted.item.data[option])
      if (from !== undefined && to !== undefined && from !== to) {
        if (scalar(entry.item[option]) === from) entry.item[option] = wanted.item.data[option]
      }
    }
  }

  const added: TemplateBlock[] = []
  for (const entry of now) {
    if (was.has(entry.key) || ofPage(next).some(({ key }) => key === entry.key)) continue
    const keys = ofPage(next)
    const before = now
      .slice(0, entry.index)
      .reverse()
      .map((preceding) => keys.find(({ key }) => key === preceding.key))
      .find((found) => found !== undefined)
    const at = before ? before.index + 1 : entry.index === 0 ? 0 : next.length
    next.splice(at, 0, {
      __component: entry.item.component,
      ...structuredClone(entry.item.data),
    })
    added.push(entry.item)
  }

  const marks = new Map(fixed.map((mark) => [`${mark.block}#${mark.nth}`, mark]))
  const onPage = new Set(ofPage(next).map(({ key }) => key))
  for (const entry of now) {
    if (!onPage.has(entry.key)) continue
    if (entry.item.fixed) marks.set(entry.key, { block: entry.block, nth: entry.nth })
    else marks.delete(entry.key)
  }
  return { zone: next, fixed: [...marks.values()], added }
}

/** The fixed marks a template gives its blocks. */
export function fixedMarksOf(blocks: readonly TemplateBlock[]): FixedMark[] {
  return ofTemplate(blocks)
    .filter(({ item }) => item.fixed)
    .map(({ block, nth }) => ({ block, nth }))
}

/**
 * What switching a page to another template does: the page's blocks that the template also has keep
 * their content, in the template's order; the template's other blocks arrive with their sample text;
 * the page's blocks the template does not have are dropped.
 *
 * @remarks
 * A block that is not of the catalogue stays, at the end. The plan is the same whether the switch is
 * made or only looked at.
 */
export function planSwitch(
  zone: readonly Row[],
  target: readonly TemplateBlock[]
): OfferResult & { plan: TemplateSwitchPlan } {
  const page = ofPage(zone)
  const byKey = new Map(page.map((entry) => [entry.key, entry]))
  const wanted = ofTemplate(target)
  const kept = new Set<string>()
  const plan: TemplateSwitchPlan = { keeps: [], adds: [], drops: [] }
  const added: TemplateBlock[] = []
  const next: Row[] = wanted.map((entry) => {
    const found = byKey.get(entry.key)
    if (found) {
      kept.add(entry.key)
      plan.keeps.push(entry.block)
      return withoutUnexposed(found.item)
    }
    plan.adds.push(entry.block)
    added.push(entry.item)
    return { __component: entry.item.component, ...structuredClone(entry.item.data) }
  })
  for (const entry of page) {
    if (!kept.has(entry.key)) plan.drops.push({ block: entry.block, position: entry.index })
  }
  const known = new Set(page.map(({ index }) => index))
  zone.forEach((entry, index) => {
    if (!known.has(index)) next.push(withoutUnexposed(entry))
  })
  return { zone: next, fixed: fixedMarksOf(target), added, plan }
}

/** A fixed block an edit would remove, or move past another fixed block. */
export interface FixedViolation {
  block: string
  reason: 'removed' | 'moved'
}

/**
 * Whether an edit of a page's zone removes a block its template fixed, or changes the order of the
 * fixed blocks among themselves.
 *
 * @remarks
 * A fixed block is found in the edit by its row `id` (with its component, since Strapi numbers the
 * rows of each component on its own), the one thing that tells it from a new block of the same type
 * put before it. An entry of the edit without an `id` is a new block, so an edit that drops the ids
 * of the fixed blocks removes them. A mark whose block the stored zone does not hold (a draft
 * restored from the published version, a block that never arrived) is ignored: it locks nothing.
 */
export function findFixedViolation(
  stored: readonly Row[],
  edited: readonly Row[],
  marks: readonly FixedMark[]
): FixedViolation | null {
  const before = new Map(ofPage(stored).map((entry) => [entry.key, entry]))
  const rowOf = (entry: Row): string | undefined =>
    entry.id === undefined || entry.id === null
      ? undefined
      : `${String(entry.__component)}:${String(entry.id)}`
  const after = new Map<string, number>()
  edited.forEach((entry, index) => {
    const row = rowOf(entry)
    if (row !== undefined) after.set(row, index)
  })
  const held = marks
    .flatMap((mark) => {
      const found = before.get(`${mark.block}#${mark.nth}`)
      return found ? [{ block: mark.block, index: found.index, row: rowOf(found.item) }] : []
    })
    .sort((a, b) => a.index - b.index)
  let last = -1
  for (const mark of held) {
    const at = mark.row === undefined ? undefined : after.get(mark.row)
    if (at === undefined) return { block: mark.block, reason: 'removed' }
    if (at < last) return { block: mark.block, reason: 'moved' }
    last = at
  }
  return null
}

/**
 * The fixed marks of a page after an edit that kept every fixed block, each moved to the place its
 * block has now: a block of the same type put before a fixed one shifts its occurrence, and the mark
 * must keep naming the fixed block, not the newcomer.
 *
 * @remarks
 * Call it only for an edit {@link findFixedViolation} accepted. A mark whose block the stored zone
 * does not hold is kept as it is.
 */
export function followFixed(
  stored: readonly Row[],
  edited: readonly Row[],
  marks: readonly FixedMark[]
): FixedMark[] {
  const before = new Map(ofPage(stored).map((entry) => [entry.key, entry.item]))
  const rowOf = (entry: Row): string => `${String(entry.__component)}:${String(entry.id)}`
  const now = new Map(
    ofPage(edited).flatMap((entry) =>
      entry.item.id === undefined || entry.item.id === null
        ? []
        : [[rowOf(entry.item), { block: entry.block, nth: entry.nth }] as const]
    )
  )
  return marks.map((mark) => {
    const was = before.get(`${mark.block}#${mark.nth}`)
    return (was && now.get(rowOf(was))) || mark
  })
}
