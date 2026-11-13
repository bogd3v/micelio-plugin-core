import { BLOCKS, optionsOf, type Block } from '../../../contract/blocks'
import { OPTION_NAMES } from '../../../contract/options'

/** The first option of a block's content that the catalogue refuses. */
export interface BlockOptionViolation {
  /** The `id` of the block in the catalogue. */
  block: string
  /** The option's name: `variant` or a name of the vocabulary. */
  option: string
  /** The value that was sent. */
  value: unknown
  /** The values the block offers for the option; empty when it does not expose it. */
  allowed: readonly string[]
}

const NAMES: readonly string[] = ['variant', ...OPTION_NAMES]

// A `scene` of `variant: background` paints its own poster: `tone` and `align` apply to its `inline`
// variant only (micelio-cms#442). The catalogue offers both on the entry; this is where they stop.
// Their defaults stay valid: a `section.scene` stores both, so a save that carries the core's default
// is not refused; only another value is. The builder leaves both out of a new background scene
// (`startingFields`), so a site's default of either never reaches one.
const BACKGROUND_SCENE = { block: 'scene', variant: 'background', options: ['tone', 'align'] }

/**
 * Finds the first option in the components of a dynamic zone that its block does not allow.
 *
 * @remarks
 * An option is refused when the block does not expose it, or when its value is not in the set the
 * block offers (a number is compared as the string Strapi stores). An option that is absent or
 * `null` takes its default and is valid. A `scene` of `variant: background` (the variant it takes
 * when it sets none) is refused a `tone` or `align` other than its default, with the default as
 * the only allowed value. A component that is not a block of the catalogue is skipped: the host's own components are none of the contract's business.
 *
 * @param components - What was sent for the zone, each with its `__component`.
 * @param blocks - The catalogue to check against.
 * @returns The violation, or `null` when every option is valid.
 */
export function findBlockOptionViolation(
  components: readonly unknown[],
  blocks: readonly Block[] = BLOCKS
): BlockOptionViolation | null {
  for (const component of components) {
    if (typeof component !== 'object' || component === null) continue
    const content = component as Record<string, unknown>
    const block = blocks.find((candidate) => candidate.schema.component === content.__component)
    if (!block) continue
    const offered = new Map(optionsOf(block))
    for (const name of NAMES) {
      const value = content[name]
      if (value === undefined || value === null) continue
      if (
        block.id === BACKGROUND_SCENE.block &&
        BACKGROUND_SCENE.options.includes(name) &&
        (content.variant ?? block.options.variant?.default) === BACKGROUND_SCENE.variant &&
        String(value) !== offered.get(name)?.default
      ) {
        return { block: block.id, option: name, value, allowed: [offered.get(name)?.default ?? ''] }
      }
      const allowed: readonly string[] = offered.get(name)?.values ?? []
      const isAllowed =
        (typeof value === 'string' || typeof value === 'number') && allowed.includes(String(value))
      if (!isAllowed) return { block: block.id, option: name, value, allowed }
    }
  }
  return null
}
