import { BLOCKS, type Block } from '../../../contract/blocks'
import { isFilled } from '../../../contract/islands'
import { SCENE_BACKGROUND_LIMIT } from '../constants/blocks'

/** A block of a zone whose static alternative lacks fields. */
export interface MissingAlternative {
  /** The `id` of the block in the catalogue. */
  block: string
  /** Its position in the zone, from 0. */
  position: number
  /** The fields of the alternative that are empty, in the order the contract lists them. */
  fields: string[]
}

/** More background Scenes in a zone than a page may hold. */
export interface BackgroundSceneExcess {
  /** The `id` of the block: `scene`. */
  block: string
  /** How many background Scenes the zone holds. */
  count: number
  /** How many it may hold. */
  limit: number
}

function blockOf(component: unknown, blocks: readonly Block[]): Block | undefined {
  return blocks.find((candidate) => candidate.schema.component === component)
}

/**
 * The blocks of a dynamic zone whose island's static alternative is not filled in.
 *
 * @remarks
 * The alternative is what a visitor gets before the island loads, in a static build and in a feed
 * (ADR-0018, section 1), so a page does not go to review without it. Only blocks that declare an
 * island are looked at, and only the fields their `alternative` lists. A component that is not a
 * block of the catalogue is skipped.
 *
 * @param components - The zone's components, each with its `__component`.
 * @param blocks - The catalogue to check against.
 */
export function findMissingAlternatives(
  components: readonly unknown[],
  blocks: readonly Block[] = BLOCKS
): MissingAlternative[] {
  return components.flatMap((component, position) => {
    if (typeof component !== 'object' || component === null) return []
    const content = component as Record<string, unknown>
    const block = blockOf(content.__component, blocks)
    const island = block?.cost.island
    if (!block || !island) return []
    const fields = island.alternative.filter((field) => !isFilled(content[field]))
    return fields.length > 0 ? [{ block: block.id, position, fields }] : []
  })
}

/**
 * Whether a dynamic zone holds more `scene` blocks with `variant: background` than a page may.
 *
 * @remarks
 * A background Scene sits behind the page, so there is one. A Scene that sets no `variant` (absent,
 * `null` or empty) takes the default the catalogue declares for it, `background`, and counts.
 *
 * @returns The excess, or `null` when the zone is within the limit.
 */
export function findBackgroundSceneExcess(
  components: readonly unknown[],
  blocks: readonly Block[] = BLOCKS
): BackgroundSceneExcess | null {
  const scene = blocks.find((block) => block.id === 'scene')
  if (!scene) return null
  const fallback = scene.options.variant?.default
  const count = components.filter((component) => {
    if (typeof component !== 'object' || component === null) return false
    const content = component as Record<string, unknown>
    if (content.__component !== scene.schema.component) return false
    const set = content.variant
    return (set === undefined || set === null || set === '' ? fallback : set) === 'background'
  }).length
  return count > SCENE_BACKGROUND_LIMIT
    ? { block: scene.id, count, limit: SCENE_BACKGROUND_LIMIT }
    : null
}
