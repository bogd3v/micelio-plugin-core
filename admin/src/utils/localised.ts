/** A text in the admin's locales, as the server sends it. */
export interface LocalisedText {
  en: string
  es?: string
}

/**
 * The text for a locale, in English when the plugin that wrote it left that locale out.
 *
 * @param locale - The admin's locale, such as `es` or `es-MX`.
 */
export function localised(text: LocalisedText, locale: string): string {
  const language = locale.split('-')[0] ?? 'en'
  const found = language === 'es' ? text.es : undefined
  return found && found.trim() !== '' ? found : text.en
}
