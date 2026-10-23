import type { Core } from '@strapi/strapi'
import { SITE_COMPONENT_CATEGORY } from '../constants/site'
import accentOverride from './accent-override.json'
import author from './author.json'
import fediverse from './fediverse.json'
import modules from './modules.json'
import socialLink from './social-link.json'
import theme from './theme.json'

// Keyed by component name; the UID is `micelio-site.<name>`.
const SITE_COMPONENTS: Record<string, object> = {
  'accent-override': accentOverride,
  author,
  fediverse,
  modules,
  'social-link': socialLink,
  theme,
}

/**
 * Adds the plugin's components to Strapi's registry.
 *
 * @remarks
 * A plugin has no `components` entry of its own: Strapi loads components only from the host's
 * `src/components`. This builds each one the way that loader does, and must run in `register`,
 * before Strapi turns content types and components into database models.
 */
export function registerComponents(strapi: Core.Strapi): void {
  const components = Object.fromEntries(
    Object.entries(SITE_COMPONENTS).map(([name, schema]) => {
      const uid = `${SITE_COMPONENT_CATEGORY}.${name}`
      const component = {
        ...structuredClone(schema),
        __schema__: structuredClone(schema),
        uid,
        category: SITE_COMPONENT_CATEGORY,
        modelType: 'component',
        modelName: name,
        globalId: `Component${pascalCase(SITE_COMPONENT_CATEGORY)}${pascalCase(name)}`,
      }
      return [uid, component]
    })
  )
  strapi.get('components').add(components)
}

function pascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}
