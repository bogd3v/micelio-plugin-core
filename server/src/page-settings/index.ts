import {
  PAGE_TYPE_ATTRIBUTE,
  VISIBILITY_ATTRIBUTE,
  VISIBILITY_COMPONENT_UID,
} from '../constants/page-settings'
import type { ContentTypeSchema } from '../site-scope'

/**
 * The schema of a page type with the page settings: its `pageType` and its `visibility`.
 *
 * @remarks
 * `pageType` is a string, not an enumeration: the budgets list the page types a site has
 * (`budgets.pageTypes`, custom ones included), and a page whose type nobody configured keeps the
 * `standard` budget (`docs/operate/budgets.md`). `visibility` is the component of the menu, the
 * sitemap and feeds, and `noindex`. Neither is localised: they describe the page, not one
 * language of it. A page type with a `slug` also gets a redirect from the old address when the
 * published slug changes (`docs/guide/pages.md`). Apply it with `withSiteScope` and
 * `withEditorial`, which the redirect and the budget need.
 *
 * @example
 * ```ts
 * import schema from './schema.json'
 * export default { schema: withSiteScope(withEditorial(withPageSettings(schema))) }
 * ```
 */
export function withPageSettings<T extends ContentTypeSchema>(schema: T): T {
  return {
    ...schema,
    pluginOptions: {
      ...schema.pluginOptions,
      micelio: { ...(schema.pluginOptions?.micelio as object | undefined), pageSettings: true },
    },
    attributes: {
      ...schema.attributes,
      [PAGE_TYPE_ATTRIBUTE]: {
        type: 'string',
        default: 'standard',
        maxLength: 64,
        pluginOptions: { i18n: { localized: false } },
      },
      [VISIBILITY_ATTRIBUTE]: {
        type: 'component',
        repeatable: false,
        component: VISIBILITY_COMPONENT_UID,
        pluginOptions: { i18n: { localized: false } },
      },
    },
  }
}

/** Whether a content type schema was made with {@link withPageSettings}. */
export function hasPageSettings(schema: { pluginOptions?: object } | undefined): boolean {
  const options = schema?.pluginOptions as { micelio?: { pageSettings?: unknown } } | undefined
  return options?.micelio?.pageSettings === true
}
