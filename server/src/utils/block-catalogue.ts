import { createHash } from 'node:crypto'
import type { Block } from '../../../contract/blocks'
import { blockJsonSchema } from '../../../contract/strapi'
import type { BlockCatalogueChangedPayload } from '../types/hooks'

/** A hash of each block of the catalogue, by block id: what the boot compares to see a change. */
export type CatalogueFingerprint = Record<string, string>

/**
 * The fingerprint of a catalogue: each block's id with a hash of what the `blockCatalogueChanged`
 * payload calls a change.
 *
 * @remarks
 * The hash covers the block's generated JSON Schema, its `options`, its `cost` and its `static`.
 * Object keys are sorted first, so the same catalogue always gives the same fingerprint.
 */
export function catalogueFingerprint(blocks: readonly Block[]): CatalogueFingerprint {
  return Object.fromEntries(
    blocks.map((block) => {
      const described = {
        schema: blockJsonSchema(block),
        options: block.options,
        cost: block.cost,
        static: block.static,
      }
      return [block.id, createHash('sha256').update(stableJson(described)).digest('hex')]
    })
  )
}

/**
 * What changed from one fingerprint to the next, as the `blockCatalogueChanged` payload: block ids,
 * sorted. Every list is empty when nothing changed.
 */
export function diffFingerprints(
  previous: CatalogueFingerprint,
  current: CatalogueFingerprint
): BlockCatalogueChangedPayload {
  const ids = (fingerprint: CatalogueFingerprint) => Object.keys(fingerprint).sort()
  return {
    added: ids(current).filter((id) => !(id in previous)),
    changed: ids(current).filter((id) => id in previous && previous[id] !== current[id]),
    removed: ids(previous).filter((id) => !(id in current)),
  }
}

/** Whether a value read back from storage is a fingerprint. */
export function isCatalogueFingerprint(value: unknown): value is CatalogueFingerprint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every((hash) => typeof hash === 'string')
}

// JSON with the keys of every object in order.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).filter(([, nested]) => nested !== undefined)
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
