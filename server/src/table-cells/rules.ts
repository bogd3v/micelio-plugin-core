/** The component of the `table` block. */
const BLOCK_COMPONENT = 'shared.table'

/** A row of a `table` a save refuses, with where it is. */
export interface CellsViolation {
  /** The dynamic zone that holds the block. */
  zone: string
  /** The block's position in its zone, from 0. */
  position: number
  /** The `id` of the block in the catalogue. */
  block: 'table'
  /** The row's position in the block's `rows`, from 0. */
  row: number
  /** How many cells the row has. */
  cells: number
  /** How many columns the table has. */
  columns: number
}

/** The length of a list, and none for anything that is not one. */
function lengthOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

/**
 * The first row of a `table` block whose number of cells is not the number of its columns.
 *
 * @remarks
 * A row holds one cell per column, in the order of the columns (micelio-cms#449). A `cells` that is
 * `null`, absent or not a list is a row of no cells, and absent `columns` are no columns. A table
 * with no rows is not checked. Only `table` blocks are looked at.
 *
 * @param zones - The dynamic zones of the save by attribute name, each a list of components.
 */
export function findCellsViolation(
  zones: Readonly<Record<string, readonly unknown[]>>
): CellsViolation | null {
  for (const [zone, components] of Object.entries(zones)) {
    for (const [position, component] of components.entries()) {
      if (typeof component !== 'object' || component === null) continue
      const content = component as Record<string, unknown>
      if (content.__component !== BLOCK_COMPONENT || !Array.isArray(content.rows)) continue
      const columns = lengthOf(content.columns)
      for (const [row, entry] of (content.rows as unknown[]).entries()) {
        const cells =
          typeof entry === 'object' && entry !== null
            ? lengthOf((entry as Record<string, unknown>).cells)
            : 0
        if (cells !== columns) return { zone, position, block: 'table', row, cells, columns }
      }
    }
  }
  return null
}
