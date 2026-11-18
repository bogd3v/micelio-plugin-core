import { errors } from '@strapi/utils'
import { SECTION_ANCHOR_INVALID } from '../constants/blocks'
import type { AnchorViolation } from './rules'

/**
 * A save refused because a section's anchor is not a kebab-case slug or is used twice in the page.
 *
 * @remarks
 * Strapi answers it as a `ValidationError` (400) where the route has no middleware to say better;
 * the `site-scope` route middleware turns it into the problem detail `docs/api.md` describes.
 */
export class SectionAnchorError extends errors.ValidationError {
  constructor(readonly violation: AnchorViolation) {
    const { reason, zone, position, block, anchor, firstUse } = violation
    const where = `The ${block} block at ${zone}.${position}`
    super(
      reason === 'format'
        ? `${where} has the anchor "${anchor}", which is not a kebab-case slug`
        : `${where} has the anchor "${anchor}", which ${firstUse!.zone}.${firstUse!.position} already uses`,
      { code: SECTION_ANCHOR_INVALID, ...violation }
    )
  }
}
