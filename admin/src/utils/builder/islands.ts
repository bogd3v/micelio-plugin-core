import {
  isFilled,
  triggerOf,
  type IslandKind,
  type IslandTrigger,
} from '../../../../contract/islands'
import type { CatalogueEntry } from './palette'

/** What the badge and the panel say of a block's island. */
export interface IslandInfo {
  kind: IslandKind
  /** What it loads once used, in kB. */
  loadKb: number
  trigger: IslandTrigger
  /** The fields of the block its static alternative is made of. */
  alternative: readonly string[]
}

/** The island a catalogue entry renders; `undefined` for a block that renders none. */
export function islandOf(entry: CatalogueEntry | undefined): IslandInfo | undefined {
  const island = entry?.cost.island
  return island
    ? {
        kind: island.kind,
        loadKb: island.loadKb,
        trigger: triggerOf(island.loadKb),
        alternative: island.alternative,
      }
    : undefined
}

/** A weight for the badge: kB with one decimal, and MB from 1024 kB up. */
export function weightText(kb: number): { unit: 'kb' | 'mb'; value: number } {
  const round = (value: number) => Math.round(value * 10) / 10
  return kb >= 1024 ? { unit: 'mb', value: round(kb / 1024) } : { unit: 'kb', value: round(kb) }
}

/** The fields of an island's static alternative that the block's values leave empty. */
export function missingAlternative(island: IslandInfo, values: Record<string, unknown>): string[] {
  return island.alternative.filter((field) => !isFilled(values[field]))
}
