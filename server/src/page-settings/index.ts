import {
  PAGE_TYPE_ATTRIBUTE,
  TEMPLATE_FIXED_ATTRIBUTE,
  TEMPLATE_ID_ATTRIBUTE,
  TEMPLATE_SAMPLES_ATTRIBUTE,
  TEMPLATE_VERSION_ATTRIBUTE,
  VISIBILITY_ATTRIBUTE,
  VISIBILITY_COMPONENT_UID,
} from '../constants/page-settings'
import type { ContentTypeSchema } from '../site-scope'

/**
 * The schema of a page type with the page settings: its `pageType`, its `visibility` and the record of
 * its template.
 *
 * @remarks
 * `templateId` and `templateVersion` record the template a page was created from (a copy, never a
 * link: the template may change or go, the page keeps its blocks), and `templateSamples` the sample
 * texts the page copied and has not replaced yet, which `performTransition` refuses to publish
 * (`sampleTextPresent`, `docs/guide/templates.md`). `templateFixed` lists the blocks the template
 * fixed (`{ block, nth }`: the nth block of that catalogue id), which editors may not remove or
 * reorder until the page is detached.
 *
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
      [TEMPLATE_ID_ATTRIBUTE]: {
        type: 'string',
        maxLength: 64,
        visible: false,
        pluginOptions: { i18n: { localized: false } },
      },
      [TEMPLATE_VERSION_ATTRIBUTE]: {
        type: 'integer',
        min: 1,
        visible: false,
        pluginOptions: { i18n: { localized: false } },
      },
      [TEMPLATE_FIXED_ATTRIBUTE]: {
        type: 'json',
        private: true,
        // Not writable from a route: a client that could name it would lift the fixed blocks.
        writable: false,
        visible: false,
        // Not localized for i18n, and never copied between locales all the same: the attribute is
        // hidden (`visible: false`), so no sync reaches it. The marks name the blocks of one
        // locale's zone and are kept per locale, like `templateId`. Making it visible would start a sync.
        pluginOptions: { i18n: { localized: false }, micelio: { export: 'always' } },
      },
      [TEMPLATE_SAMPLES_ATTRIBUTE]: {
        type: 'json',
        private: true,
        visible: false,
        // Private for the content API, and still in a site archive: a page that moves keeps the sample
        // texts it must replace before it is published.
        pluginOptions: { i18n: { localized: false }, micelio: { export: 'always' } },
      },
    },
  }
}

/** Whether a content type schema was made with {@link withPageSettings}. */
export function hasPageSettings(schema: { pluginOptions?: object } | undefined): boolean {
  const options = schema?.pluginOptions as { micelio?: { pageSettings?: unknown } } | undefined
  return options?.micelio?.pageSettings === true
}
