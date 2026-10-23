import { PLUGIN_ID } from '../pluginId'

/**
 * The plugin-scoped id of a translation key (`plugin.name` becomes `micelio.plugin.name`).
 *
 * @param id - Key in `admin/src/translations/<locale>.json`.
 * @returns The id the admin's i18n registry knows it by.
 */
const getTranslation = (id: string): string => `${PLUGIN_ID}.${id}`

export { getTranslation }
