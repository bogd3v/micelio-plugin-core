import { errors } from '@strapi/utils'
import type { BlockOptionViolation } from './rules'

/** The `code` of the problem detail a refused option answers. */
export const BLOCK_OPTION_INVALID = 'blockOptionInvalid'

/**
 * A save refused because a block's option is not one the catalogue allows.
 *
 * @remarks
 * Strapi answers it as a `ValidationError` (400) where the route has no middleware to say better;
 * the `site-scope` route middleware turns it into the problem detail `docs/api.md` describes.
 */
export class BlockOptionError extends errors.ValidationError {
  constructor(readonly violation: BlockOptionViolation) {
    const { block, option, allowed } = violation
    super(
      allowed.length
        ? `The ${block} block does not allow that value for ${option}; allowed: ${allowed.join(', ')}`
        : `The ${block} block does not expose the option ${option}`,
      { code: BLOCK_OPTION_INVALID, block, option, allowed }
    )
  }
}
