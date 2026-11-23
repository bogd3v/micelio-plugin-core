import { errors } from '@strapi/utils'
import { TESTIMONIAL_RATING_INVALID } from '../constants/blocks'
import type { RatingViolation } from './rules'

/**
 * A save refused because a testimonial's `rating` is not a whole number from 1 to 5.
 *
 * @remarks
 * Strapi answers it as a `ValidationError` (400) where the route has no middleware to say better;
 * the `site-scope` route middleware turns it into the problem detail `docs/api.md` describes.
 */
export class TestimonialRatingError extends errors.ValidationError {
  constructor(readonly violation: RatingViolation) {
    const { zone, position, item, rating, min, max } = violation
    super(
      `The testimonials block at ${zone}.${position} has the rating ${JSON.stringify(rating)} in item ${item}, which is not a whole number from ${min} to ${max}`,
      { code: TESTIMONIAL_RATING_INVALID, ...violation }
    )
  }
}
