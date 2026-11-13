import { errors } from '@strapi/utils'
import { ICON_INVALID } from '../constants/icons'
import type { IconViolation } from './rules'

/**
 * A save refused because a field `micelio.icon` holds a value that is not a name of the pinned
 * catalogue or one of its aliases.
 *
 * @remarks
 * Strapi answers it as a `ValidationError` (400) where the route has no middleware to say better;
 * the `site-scope` route middleware turns it into the problem detail `docs/api.md` describes.
 */
export class IconInvalidError extends errors.ValidationError {
  constructor(readonly violation: IconViolation) {
    const { field, path, value } = violation
    const shown = typeof value === 'string' ? `"${value.slice(0, 64)}"` : JSON.stringify(value)
    super(`The field ${path} holds ${shown}, which is not a name of the icon catalogue`, {
      code: ICON_INVALID,
      field,
      path,
    })
  }
}
