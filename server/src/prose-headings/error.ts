import { errors } from '@strapi/utils'
import { PROSE_HEADING_INVALID } from '../constants/blocks'
import type { ProseHeadingViolation } from './rules'

/**
 * A save refused because the Markdown of a `prose` block breaks the heading rule: it opens at `h2`,
 * has no `h1` and does not skip a level.
 *
 * @remarks
 * Strapi answers it as a `ValidationError` (400) where the route has no middleware to say better;
 * the `site-scope` route middleware turns it into the problem detail `docs/api.md` describes.
 */
export class ProseHeadingError extends errors.ValidationError {
  constructor(readonly violation: ProseHeadingViolation) {
    const { reason, zone, position, level, heading, line, previousLevel } = violation
    const where = `The prose block at ${zone}.${position}`
    const found = `the h${level} "${heading}" on line ${line} of its body`
    super(
      {
        opensWithH1: `${where} opens with ${found}; a block opens at h2`,
        opensBelowH2: `${where} opens with ${found}; a block opens at h2`,
        h1: `${where} has ${found}; a block has no h1`,
        skipsLevel: `${where} has ${found}, which skips from h${previousLevel}`,
      }[reason],
      { code: PROSE_HEADING_INVALID, ...violation }
    )
  }
}
