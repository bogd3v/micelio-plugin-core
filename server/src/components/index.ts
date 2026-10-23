import type { Core } from '@strapi/strapi'
import { EDITORIAL_COMPONENT_CATEGORY } from '../constants/editorial'
import { SITE_COMPONENT_CATEGORY } from '../constants/site'
import editorial from './editorial/editorial.json'
import accentOverride from './site/accent-override.json'
import author from './site/author.json'
import fediverse from './site/fediverse.json'
import modules from './site/modules.json'
import socialLink from './site/social-link.json'
import theme from './site/theme.json'

// Keyed by category, then by component name: the UID is `<category>.<name>`.
const COMPONENTS: Record<string, Record<string, object>> = {
  [SITE_COMPONENT_CATEGORY]: {
    'accent-override': accentOverride,
    author,
    fediverse,
    modules,
    'social-link': socialLink,
    theme,
  },
  [EDITORIAL_COMPONENT_CATEGORY]: { editorial },
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
    Object.entries(COMPONENTS).flatMap(([category, schemas]) =>
      Object.entries(schemas).map(([name, schema]) => {
        const uid = `${category}.${name}`
        const component = {
          ...structuredClone(schema),
          __schema__: structuredClone(schema),
          uid,
          category,
          modelType: 'component',
          modelName: name,
          globalId: `Component${pascalCase(category)}${pascalCase(name)}`,
        }
        return [uid, component]
      })
    )
  )
  strapi.get('components').add(components)
}

function pascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}
