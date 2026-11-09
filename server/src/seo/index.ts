import type { Core } from '@strapi/strapi'
import { SEO_ATTRIBUTE, SEO_COMPONENT_UID, SEO_LIFTED_LIMITS } from '../constants/seo'

/** Whether a content type schema has the SEO component of the host (`seo`, a `shared.seo` component). */
export function hasSeo(schema: { attributes?: object } | undefined): boolean {
  const attribute = (
    schema?.attributes as Record<string, { type?: string; component?: string }> | undefined
  )?.[SEO_ATTRIBUTE]
  return attribute?.type === 'component' && attribute.component === SEO_COMPONENT_UID
}

/**
 * Takes the `maxLength` off the meta title and the meta description of the host's `shared.seo`,
 * so a counter can warn while the editor types and the save never refuses (`docs/guide/seo.md`).
 *
 * @remarks
 * Strapi enforces `maxLength` on a draft too. The limits are checked when the page leaves `draft`
 * instead (`checkSeoBeforeReview`). A host without the component is left as it is; it runs on
 * every boot and changes nothing the second time.
 */
export function liftSeoLimits(strapi: Core.Strapi): void {
  const component = (
    strapi.components as unknown as Record<
      string,
      {
        attributes?: Record<string, { maxLength?: number }>
        __schema__?: { attributes?: Record<string, { maxLength?: number }> }
      }
    >
  )[SEO_COMPONENT_UID]
  for (const attributes of [component?.attributes, component?.__schema__?.attributes]) {
    for (const name of SEO_LIFTED_LIMITS) {
      if (attributes?.[name]) delete attributes[name].maxLength
    }
  }
}
