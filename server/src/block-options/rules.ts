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

/**
 * Finds the first option in the components of a dynamic zone that its block does not allow.
 *
 * @remarks
 * An option is refused when the block does not expose it, or when its value is not in the set the
 * block offers (a number is compared as the string Strapi stores). An option that is absent or
 * `null` takes its default and is valid. A component that is not a block of the catalogue is
 * skipped: the host's own components are none of the contract's business.
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
      const allowed: readonly string[] = offered.get(name)?.values ?? []
      const isAllowed =
        (typeof value === 'string' || typeof value === 'number') && allowed.includes(String(value))
      if (!isAllowed) return { block: block.id, option: name, value, allowed }
    }
  }
  return null
}
