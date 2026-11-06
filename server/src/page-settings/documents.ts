import { errors } from '@strapi/utils'
import type { Core, Modules } from '@strapi/strapi'
import { REDIRECT_UID } from '../constants/page-settings'
import { isSitePath } from './redirects'

/** The actions that write `data`; `clone` takes it too (the Content Manager's duplicate). */
const CHECKED_ACTIONS: ReadonlySet<string> = new Set(['create', 'update', 'clone'])

type Params = Record<string, unknown> & { data?: Record<string, unknown> }

/**
 * The document service middleware that refuses a redirect whose `from` or `to` is not a path of
 * the site (`isSitePath`), on every write path: the Content Manager, the drawer and the code.
 *
 * @remarks
 * It checks `create`, `update` and `clone` (the Content Manager's duplicate), the actions of
 * Strapi 5.60 that take `data`. `publish` and `discardDraft` copy a row already stored, and the
 * list refuses a stored row that fails the rule.
 * Only the fields the data names are checked, so an update of another field cannot fail on them.
 *
 * @throws ValidationError (400) naming the field.
 */
export function redirectDocuments(_strapi: Core.Strapi): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    if (context.uid !== REDIRECT_UID) return next()
    if (!CHECKED_ACTIONS.has(context.action)) return next()
    const data = (context.params as Params).data
    for (const field of ['from', 'to']) {
      if (data && field in data && !isSitePath(data[field])) {
        throw new errors.ValidationError(
          `A redirect's ${field} must be a path of the site: one "/" first, no scheme, no "//", no backslash`,
          { code: 'redirectInvalid', field }
        )
      }
    }
    return next()
  }
}
