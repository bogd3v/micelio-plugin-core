import { BLOCKS, type Block } from '../../../contract/blocks'

/** The `id` of the catalogue's Markdown block, and the field its Markdown is stored in. */
const PROSE_BLOCK = 'prose'
const BODY_FIELD = 'body'

/** The level a block's first heading must have: a page already has its `h1`. */
const OPENING_LEVEL = 2

/** A heading in Markdown source: ATX (`## Title`) or setext (a line over `===` or `---`). */
interface Heading {
  level: number
  /** The heading's text, without its markers. */
  text: string
  /** Its line in the body, from 1. */
  line: number
}

/** Why a body is refused. */
export type ProseHeadingReason =
  /** The first heading is an `h1`. */
  | 'opensWithH1'
  /** The first heading is below `h2` (`h3` to `h6`). */
  | 'opensBelowH2'
  /** An `h1` after the opening heading. */
  | 'h1'
  /** A heading more than one level below the one before it. */
  | 'skipsLevel'

/** A body a save refuses, with where it is. */
export interface ProseHeadingViolation {
  reason: ProseHeadingReason
  /** The dynamic zone that holds the block. */
  zone: string
  /** The block's position in its zone, from 0. */
  position: number
  /** The `id` of the block in the catalogue: `prose`. */
  block: string
  /** The offending heading's level, 1 to 6. */
  level: number
  /** The offending heading's text. */
  heading: string
  /** Its line in the body, from 1. */
  line: number
  /** For `skipsLevel`, the level of the heading before it. */
  previousLevel?: number
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/
const SETEXT_H1 = /^ {0,3}=+[ \t]*$/
const SETEXT_H2 = /^ {0,3}-+[ \t]*$/
// A line that can be the text of a setext heading: a paragraph line, not a heading, list, quote or rule.
const PARAGRAPH = /^ {0,3}[^\s#>*+\-=_`~|\d<]/

/**
 * The headings of a Markdown body, in order, with the ones inside a fenced code block left out.
 *
 * @param markdown - The body as stored.
 */
export function headingsOf(markdown: string): Heading[] {
  const headings: Heading[] = []
  const lines = markdown.split(/\r\n|\r|\n/)
  let fence: { char: string; size: number } | null = null
  for (const [index, line] of lines.entries()) {
    const opening = FENCE.exec(line)
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
      if (closing && closing[1]![0] === fence.char && closing[1]!.length >= fence.size) fence = null
      continue
    }
    if (opening) {
      fence = { char: opening[1]![0]!, size: opening[1]!.length }
      continue
    }
    const atx = ATX.exec(line)
    if (atx) {
      const text = (atx[2] ?? '').replace(/[ \t]+#+$/, '').replace(/^#+$/, '')
      headings.push({ level: atx[1]!.length, text: text.trim(), line: index + 1 })
      continue
    }
    const previous = index > 0 ? lines[index - 1]! : ''
    const level = SETEXT_H1.test(line) ? 1 : SETEXT_H2.test(line) ? 2 : 0
    if (level && PARAGRAPH.test(previous) && !ATX.test(previous)) {
      headings.push({ level, text: previous.trim(), line: index })
    }
  }
  return headings
}

/**
 * The first heading of a Markdown body that breaks the rule of a `prose` block: it opens at `h2`,
 * has no `h1` and does not skip a level going down (`h2` to `h4`); going back up is free.
 *
 * @param markdown - The body as stored.
 * @returns The violation without its zone, position and block, or `null` for a sound body.
 */
export function findHeadingFault(
  markdown: string
): Pick<ProseHeadingViolation, 'reason' | 'level' | 'heading' | 'line' | 'previousLevel'> | null {
  let previous: Heading | null = null
  for (const heading of headingsOf(markdown)) {
    const { level, text, line } = heading
    const at = { level, heading: text, line }
    if (!previous) {
      if (level === 1) return { reason: 'opensWithH1', ...at }
      if (level > OPENING_LEVEL) return { reason: 'opensBelowH2', ...at }
    } else if (level === 1) {
      return { reason: 'h1', ...at }
    } else if (level > previous.level + 1) {
      return { reason: 'skipsLevel', ...at, previousLevel: previous.level }
    }
    previous = heading
  }
  return null
}

/**
 * The first `prose` block of a save whose body breaks the heading rule.
 *
 * @remarks
 * `section.rich-text` is not a block of the catalogue and is not checked. An absent, `null` or empty
 * body has no headings. The zones are looked at in the order of `zones`.
 *
 * @param zones - The dynamic zones of the save by attribute name, each a list of components.
 * @param blocks - The catalogue to check against.
 */
export function findProseHeadingViolation(
  zones: Readonly<Record<string, readonly unknown[]>>,
  blocks: readonly Block[] = BLOCKS
): ProseHeadingViolation | null {
  const prose = blocks.find((block) => block.id === PROSE_BLOCK)
  if (!prose) return null
  for (const [zone, components] of Object.entries(zones)) {
    for (const [position, component] of components.entries()) {
      if (typeof component !== 'object' || component === null) continue
      const content = component as Record<string, unknown>
      if (content.__component !== prose.schema.component) continue
      const body = content[BODY_FIELD]
      if (typeof body !== 'string') continue
      const fault = findHeadingFault(body)
      if (fault) return { ...fault, zone, position, block: prose.id }
    }
  }
  return null
}
