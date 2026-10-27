// The admin entry point Strapi loads through the `./strapi-admin` export. It registers the plugin,
// its pages and its translations.
import type { StrapiApp } from '@strapi/strapi/admin'

import { Initializer } from './components/Initializer'
import { MicelioIcon } from './components/MicelioIcon'
import { registerPage } from './pageRegistry'
import { PLUGIN_ID } from './pluginId'
import { getTranslation } from './utils/getTranslation'

type Translations = Record<string, string>

const plugin: StrapiApp['appPlugins'][string] = {
  register(app) {
    // The entry has no permission of its own: every admin user sees it, and the sub-navigation
    // shows each item only to a role that has the item's permission (About needs none).
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: MicelioIcon,
      intlLabel: { id: getTranslation('plugin.name'), defaultMessage: 'Micelio' },
      permissions: [],
      Component: () => import('./pages/MicelioLayout'),
    })
    app.registerPlugin({
      id: PLUGIN_ID,
      initializer: Initializer,
      isReady: false,
      name: PLUGIN_ID,
      // For sibling plugins: `app.getPlugin('micelio').apis.registerPage(id, loader)`.
      apis: { registerPage },
    })
  },

  async bootstrap(app) {
    // The Content Manager registers after the plugins have registered, so its API is reached here.
    // The action is imported when it is needed: it imports the admin, which `require` cannot load
    // (`test/package.test.ts`), as the pages above are.
    const { apis } = app.getPlugin('content-manager')
    const add = apis.addDocumentHeaderAction
    if (typeof add !== 'function') return
    const { PreviewHeaderAction } = await import('./components/PreviewHeaderAction')
    add([PreviewHeaderAction])
    const addPanel = apis.addEditViewSidePanel
    if (typeof addPanel !== 'function') return
    const { CostPanel } = await import('./components/CostPanelAction')
    addPanel([CostPanel])
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
