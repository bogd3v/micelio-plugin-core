import { EDITORIAL_ATTRIBUTE, EDITORIAL_COMPONENT_UID } from '../constants/editorial'
import type { ContentTypeSchema } from '../site-scope'

/**
 * The schema of a publishable content type with the editorial component.
 *
 * @remarks
 * It turns on Strapi's draft and publish, which stores the published snapshot, and adds the
 * `editorial` component (ADR-0017, section 5). From then on the entry is published and
 * unpublished only through the `transitions` service: publishing it any other way, the Content
 * Manager included, is refused. In a localised type each locale has its own state, as it has its
 * own published version. Apply `withSiteScope` too: the policy of a transition is the entry's
 * site's.
 *
 * @example
 * ```ts
 * import schema from './schema.json'
 * export default { schema: withSiteScope(withEditorial(schema)) }
 * ```
 */
export function withEditorial<T extends ContentTypeSchema>(schema: T): T {
  return {
    ...schema,
    options: { ...(schema.options as object | undefined), draftAndPublish: true },
    pluginOptions: {
      ...schema.pluginOptions,
      micelio: { ...(schema.pluginOptions?.micelio as object | undefined), editorial: true },
    },
    attributes: {
      ...schema.attributes,
      [EDITORIAL_ATTRIBUTE]: {
        type: 'component',
        repeatable: false,
        component: EDITORIAL_COMPONENT_UID,
        required: true,
        // Publishing is per locale, so is the state: unset, i18n would share one across locales.
        pluginOptions: { i18n: { localized: true } },
      },
    },
  }
}

/** Whether a content type schema was made with {@link withEditorial}. */
export function isEditorial(schema: { pluginOptions?: object } | undefined): boolean {
  const options = schema?.pluginOptions as { micelio?: { editorial?: unknown } } | undefined
  return options?.micelio?.editorial === true
}
