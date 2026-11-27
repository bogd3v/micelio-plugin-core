import { errors } from '@strapi/utils'
import { TABLE_CELLS_INVALID } from '../constants/blocks'
import type { CellsViolation } from './rules'

/**
 * A save refused because a row of a `table` block has another number of cells than its columns.
 *
 * @remarks
 * Strapi answers it as a `ValidationError` (400) where the route has no middleware to say better;
 * the `site-scope` route middleware turns it into the problem detail `docs/api.md` describes.
 */
export class TableCellsError extends errors.ValidationError {
  constructor(readonly violation: CellsViolation) {
    const { zone, position, row, cells, columns } = violation
    super(
      `The table block at ${zone}.${position} has ${cells} cells in row ${row}, which is not its ${columns} columns`,
      { code: TABLE_CELLS_INVALID, ...violation }
    )
  }
}
