/** The component of the `code` block. */
const BLOCK_COMPONENT = 'shared.code'

/** A highlighted line a save refuses, with where it is. */
export interface HighlightViolation {
  /** The dynamic zone that holds the block. */
  zone: string
  /** The block's position in its zone, from 0. */
  position: number
  /** The `id` of the block in the catalogue. */
  block: 'code'
  /** The line as written. */
  line: unknown
  /** How many lines the code has. */
  lines: number
}

/** How many lines a code text has: the pieces between line breaks, none for an empty text. */
function countLines(code: unknown): number {
  if (typeof code !== 'string' || code === '') return 0
  const lines = code.split(/\r\n|\r|\n/)
  // A final line break ends the last line; it does not open another.
  if (lines.at(-1) === '') lines.pop()
  return lines.length
}

/**
 * The first `highlight` line of a `code` block that is not a whole number from 1 to the number of
 * lines of its `code`.
 *
 * @remarks
 * `null` and an absent `highlight` are no lines and are not checked; neither is a block with no
 * `code` and no `highlight`. A `highlight` with a line and no `code` is refused: there is no line to
 * mark. A `highlight` that is not a list is refused with the value as `line`. Only `code` blocks
 * are looked at.
 *
 * @param zones - The dynamic zones of the save by attribute name, each a list of components.
 */
export function findHighlightViolation(
  zones: Readonly<Record<string, readonly unknown[]>>
): HighlightViolation | null {
  for (const [zone, components] of Object.entries(zones)) {
    for (const [position, component] of components.entries()) {
      if (typeof component !== 'object' || component === null) continue
      const content = component as Record<string, unknown>
      if (content.__component !== BLOCK_COMPONENT) continue
      const highlight = content.highlight
      if (highlight === null || highlight === undefined) continue
      const lines = countLines(content.code)
      // Something that is not a list is one bad line, written as it came.
      for (const line of Array.isArray(highlight) ? (highlight as unknown[]) : [highlight]) {
        const inside =
          typeof line === 'number' && Number.isInteger(line) && line >= 1 && line <= lines
        if (!Array.isArray(highlight) || !inside) {
          return {
            zone,
            position,
            block: 'code',
            line: Array.isArray(highlight) ? line : highlight,
            lines,
          }
        }
      }
    }
  }
  return null
}
