import type { Core, Modules, UID } from '@strapi/strapi'
import type { IconsService } from '../services/icons'
import { IconInvalidError } from './error'
import { findIconViolation } from './rules'

/** The actions that write `data`; `clone` takes it too (the Content Manager's duplicate). */
const CHECKED_ACTIONS: ReadonlySet<string> = new Set(['create', 'update', 'clone'])

type Params = Record<string, unknown> & { data?: Record<string, unknown> }
type Attributes = NonNullable<Parameters<typeof findIconViolation>[0]>

/**
 * The document service middleware that refuses a save whose field `micelio.icon` holds something
 * that is not a pinned name or alias of the icon catalogue (ADR-0021, section 5).
 *
 * @remarks
 * On `create`, `update` and `clone` of any type, for the fields of the type, of its components and
 * of the blocks of its dynamic zones that the data names. Stored content is not re-checked: only
 * what is being written, so a name that a later pin dropped does not stop an unrelated save.
 *
 * @throws {@link IconInvalidError} naming the field and its path.
 */
export function iconDocuments(strapi: Core.Strapi): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    if (!CHECKED_ACTIONS.has(context.action)) return next()
    const data = (context.params as Params).data
    if (data) {
      const attributes = strapi.contentType(context.uid as UID.ContentType)
        .attributes as unknown as Attributes
      const violation = findIconViolation(
        attributes,
        data,
        (uid) => strapi.components[uid as UID.Component]?.attributes as unknown as Attributes,
        (strapi.plugin('micelio').service('icons') as IconsService).catalogue
      )
      if (violation) throw new IconInvalidError(violation)
    }
    return next()
  }
}
