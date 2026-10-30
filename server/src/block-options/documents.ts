import type { Core, Modules, UID } from '@strapi/strapi'
import { BlockOptionError } from './error'
import { findBlockOptionViolation } from './rules'

/** The actions that write `data`; `clone` takes it too (the Content Manager's duplicate). */
const CHECKED_ACTIONS: ReadonlySet<string> = new Set(['create', 'update', 'clone'])

type Params = Record<string, unknown> & { data?: Record<string, unknown> }

/**
 * The document service middleware that refuses a save whose blocks carry an option the catalogue
 * does not allow (ADR-0018, section 1).
 *
 * @remarks
 * On `create`, `update` and `clone` (the Content Manager's duplicate) of any type, it checks every dynamic zone in the data. The zones the
 * data does not name are left alone, so a save that does not touch the blocks cannot fail on them.
 * Stored content is not re-checked: only what is being written.
 *
 * @throws {@link BlockOptionError} with the block, the option and the values it allows.
 */
export function blockOptionsDocuments(
  strapi: Core.Strapi
): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    if (!CHECKED_ACTIONS.has(context.action)) return next()
    const data = (context.params as Params).data
    if (data) {
      const attributes = strapi.contentType(context.uid as UID.ContentType).attributes
      for (const [name, attribute] of Object.entries(attributes)) {
        const zone = data[name]
        if (attribute.type !== 'dynamiczone' || !Array.isArray(zone)) continue
        const violation = findBlockOptionViolation(zone)
        if (violation) throw new BlockOptionError(violation)
      }
    }
    return next()
  }
}
