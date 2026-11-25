import { errors } from '@strapi/utils'
import { CODE_HIGHLIGHT_INVALID } from '../constants/blocks'
import type { HighlightViolation } from './rules'

/**
 * A save refused because a `code` block highlights a line its code does not have.
 *
 * @remarks
 * Strapi answers it as a `ValidationError` (400) where the route has no middleware to say better;
 * the `site-scope` route middleware turns it into the problem detail `docs/api.md` describes.
 */
export class CodeHighlightError extends errors.ValidationError {
  constructor(readonly violation: HighlightViolation) {
    const { zone, position, line, lines } = violation
    super(
      `The code block at ${zone}.${position} highlights ${JSON.stringify(line)}, which is not a line from 1 to ${lines} of its code`,
      { code: CODE_HIGHLIGHT_INVALID, ...violation }
    )
  }
}
