import { useIntl } from 'react-intl'

import en from './translations/en.json'
import { formatKb, formatMg } from './utils/costMeter'
import { getTranslation } from './utils/getTranslation'

/** The translator of the plugin's admin strings, with the English text as the default. */
export interface Messages {
  /** The message `id` (a key of `translations/en.json`), filled with `values`. */
  t: (id: string, values?: Record<string, string | number>) => string
  /** A date and time, in the admin's language. */
  date: (iso: string) => string
  /** A weight in kB with one decimal, in the editor's locale (`formatKb`). */
  kb: (value: number) => string
  /** A carbon estimate in mg of CO2e with up to one decimal, in the editor's locale (`formatMg`). */
  mg: (value: number) => string
}

/** Whether `id` is a key of the plugin's translations. */
export function hasMessage(id: string): boolean {
  return Object.hasOwn(en, id)
}

/** `formatMessage` with the English text as the default, so the page reads right before a locale loads. */
export function useMessages(): Messages {
  const { formatMessage, formatDate, locale } = useIntl()
  return {
    t: (id, values) =>
      formatMessage(
        { id: getTranslation(id), defaultMessage: (en as Record<string, string>)[id] ?? id },
        values
      ),
    // Seconds included: a run again within the same minute must read as new.
    date: (iso) => formatDate(iso, { dateStyle: 'medium', timeStyle: 'medium' }),
    kb: (value) => formatKb(value, locale),
    mg: (value) => formatMg(value, locale),
  }
}
