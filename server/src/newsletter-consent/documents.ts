import type { Core, Modules, UID } from '@strapi/strapi'
import { findMissingConsent } from './rules'

/** The actions that write `data`; `clone` takes it too (the Content Manager's duplicate). */
const CHECKED_ACTIONS: ReadonlySet<string> = new Set(['create', 'update', 'clone'])

type Params = Record<string, unknown> & { data?: Record<string, unknown> }

/**
 * The document service middleware that warns when a save holds a `newsletter` block without
 * `consentText`, and saves it all the same.
 *
 * @remarks
 * On `create`, `update` and `clone` of any type, for each dynamic zone the data names: one line of
 * the server log, at `warn`, names the type, the zone and the position of each such block. It never
 * refuses a save and never fills the text in: a consent text is a node's own legal wording
 * (standard, principle 2). The warning comes after the save, so a save that another check refuses
 * says nothing. Stored content is not re-checked: only what is being written.
 */
export function newsletterConsentDocuments(
  strapi: Core.Strapi
): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    if (!CHECKED_ACTIONS.has(context.action)) return next()
    const data = (context.params as Params).data
    const result = await next()
    if (data) {
      const attributes = strapi.contentType(context.uid as UID.ContentType).attributes
      const zones: Record<string, unknown[]> = {}
      for (const [name, attribute] of Object.entries(attributes)) {
        const zone = data[name]
        if (attribute.type === 'dynamiczone' && Array.isArray(zone)) zones[name] = zone
      }
      for (const { zone, position } of findMissingConsent(zones)) {
        strapi.log.warn(
          `[micelio] the newsletter block at ${context.uid} ${zone}.${position} has no consentText; ` +
            'it renders no consent line and no checkbox'
        )
      }
    }
    return result
  }
}
