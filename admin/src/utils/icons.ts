// What the icon picker shares with the pages that host it: the shape of `GET /micelio/icons`
// (`server/src/types/icons.ts`, read type-only), the keys of its grid and its limits.
import type { IconAnswerEntry, IconsAnswer } from '../../../server/src/types/icons'

export type { IconAnswerEntry, IconsAnswer }

/** The UID of the custom field the picker is for (`server/src/constants/icons.ts`). */
export const ICON_FIELD = 'plugin::micelio.icon'

/** Glyphs to a row of the picker's listbox (artboard `IconPicker`). */
export const GRID_COLUMNS = 6

/** How many category chips show before "More". */
export const CHIPS_SHOWN = 5

/** How many entries one request asks for. */
export const PAGE_SIZE = 120

/** The language of the labels the admin asks for: Spanish for any `es` locale, else English. */
export const labelLocale = (locale: string): 'en' | 'es' => (locale.startsWith('es') ? 'es' : 'en')

/**
 * Where the key moves the focused glyph of the grid.
 *
 * @returns The new index; `-1` leaves the grid upwards, to the search; `undefined` for a key the
 * grid does not use.
 */
export function moveInGrid(key: string, index: number, count: number): number | undefined {
  switch (key) {
    case 'ArrowRight':
      return Math.min(index + 1, count - 1)
    case 'ArrowLeft':
      return Math.max(index - 1, 0)
    case 'ArrowDown':
      return index + GRID_COLUMNS < count ? index + GRID_COLUMNS : count - 1
    case 'ArrowUp':
      return index - GRID_COLUMNS >= 0 ? index - GRID_COLUMNS : -1
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return undefined
  }
}

/** Whether a value is a string that names something. */
export const isName = (value: unknown): value is string => typeof value === 'string' && value !== ''
