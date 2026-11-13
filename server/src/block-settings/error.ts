import { errors } from '@strapi/utils'
import { BLOCK_NOT_ALLOWED, BLOCK_SETTING_INVALID } from '../constants/blocks'

/** Why a block cannot be inserted on a page: the site disabled it, does not allow it on the page's type, or has off the module it needs. */
export interface BlockNotAllowedViolation {
  /** The `id` of the block in the catalogue. */
  block: string
  reason: 'disabled' | 'pageType' | 'moduleOff'
  /** The module the block needs, which the site has off; set when `reason` is `moduleOff`. */
  module?: string
  /** The page type of the save; set when `reason` is `pageType`. */
  pageType?: string
}

/**
 * A save refused because it adds a block the site disabled or does not allow on the page's type
 * (ADR-0017, section 4, "Block catalogue management").
 *
 * @remarks
 * Strapi answers it as a `ValidationError` (400) where the route has no middleware to say better;
 * the `site-scope` route middleware turns it into the problem detail `docs/api.md` describes.
 */
export class BlockNotAllowedError extends errors.ValidationError {
  constructor(readonly violation: BlockNotAllowedViolation) {
    const { block, reason, pageType, module } = violation
    super(
      reason === 'moduleOff'
        ? `The ${block} block needs the ${module} module, which is off on this site`
        : reason === 'disabled'
          ? `The ${block} block is disabled on this site`
          : `The ${block} block is not allowed on ${pageType} pages of this site`,
      { code: BLOCK_NOT_ALLOWED, ...violation }
    )
  }
}

/** A setting refused because it names a block, a page type or a label the catalogue does not have. */
export class BlockSettingError extends errors.ValidationError {
  constructor(
    /** The field of the setting that is wrong. */
    readonly field: string,
    detail: string
  ) {
    super(detail, { code: BLOCK_SETTING_INVALID, field })
  }
}
