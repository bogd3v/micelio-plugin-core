import { useMemo } from 'react'

import { fieldsOf, type BlockFields } from '../utils/builder/fields'
import type { BuilderBlock } from '../utils/builder/model'
import type { CatalogueEntry } from '../utils/builder/palette'
import type { BuilderCatalogue } from './useBuilderCatalogue'

/** What the site's catalogue says of one block of the page. */
interface BlockLookup {
  /** The catalogue entries by component UID. */
  byComponent: Map<string, CatalogueEntry>
  /** The entry of the block; `undefined` when the site no longer lists it. */
  entryOf: (block: BuilderBlock) => CatalogueEntry | undefined
  /** The fields of the block's panel, with the option values its contract allows. */
  fieldsFor: (block: BuilderBlock) => BlockFields
  /** The fields of the items of each of the block's repeatable fields, by field name. */
  itemFieldsFor: (block: BuilderBlock) => Record<string, BlockFields>
}

/** Reads the catalogue for the blocks of a page: the entry, the fields and the item fields. */
export function useBlockLookup(catalogue: BuilderCatalogue | undefined): BlockLookup {
  const entries = catalogue?.entries
  const byComponent = useMemo(
    () => new Map((entries ?? []).map((entry) => [entry.component, entry])),
    [entries]
  )
  const entryOf = (block: BuilderBlock): CatalogueEntry | undefined =>
    byComponent.get(block.component)
  const fieldsFor = (block: BuilderBlock): BlockFields =>
    fieldsOf(
      catalogue?.schemas[block.component],
      Object.fromEntries(
        Object.entries(entryOf(block)?.options ?? {}).map(([name, option]) => [name, option.values])
      )
    )
  const itemFieldsFor = (block: BuilderBlock): Record<string, BlockFields> =>
    Object.fromEntries(
      fieldsFor(block).items.map((group) => [
        group.name,
        fieldsOf(catalogue?.schemas[group.component], {}),
      ])
    )
  return { byComponent, entryOf, fieldsFor, itemFieldsFor }
}
