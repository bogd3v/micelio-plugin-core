// The admin entry point Strapi loads through the `./strapi-admin` export. It registers the plugin
// and its translations; pages (the status page, #8) arrive with their issues.
import type { StrapiApp } from '@strapi/strapi/admin'

import { Initializer } from './components/Initializer'
import { PLUGIN_ID } from './pluginId'
import { getTranslation } from './utils/getTranslation'

type Translations = Record<string, string>

const plugin: StrapiApp['appPlugins'][string] = {
  register(app) {
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
