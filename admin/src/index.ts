// The admin entry point Strapi loads through the `./strapi-admin` export. It registers the plugin,
// its pages and its translations.
import type { StrapiApp } from '@strapi/strapi/admin'

import { Initializer } from './components/Initializer'
import { StatusIcon } from './components/StatusIcon'
import { STATUS_READ_PERMISSION } from './permissions'
import { PLUGIN_ID } from './pluginId'
import { getTranslation } from './utils/getTranslation'

type Translations = Record<string, string>

const plugin: StrapiApp['appPlugins'][string] = {
  register(app) {
    // The status page, shown only to a role with its permission (the super admin has it).
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: StatusIcon,
      intlLabel: { id: getTranslation('plugin.name'), defaultMessage: 'Micelio' },
      permissions: [STATUS_READ_PERMISSION],
      Component: () => import('./pages/StatusPage'),
    })
    app.registerPlugin({
      id: PLUGIN_ID,
      initializer: Initializer,
      isReady: false,
      name: PLUGIN_ID,
    })
  },

  async registerTrads({ locales }) {
    return Promise.all(
      locales.map(async (locale) => {
        try {
          const { default: data } = (await import(`./translations/${locale}.json`)) as {
            default: Translations
          }
          const prefixed: Translations = {}
          for (const [key, value] of Object.entries(data)) {
            prefixed[getTranslation(key)] = value
          }
          return { data: prefixed, locale }
        } catch {
          return { data: {}, locale }
        }
      })
    )
  },
}

export default plugin
