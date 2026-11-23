import { TESTIMONIAL_RATING_RANGE } from '../constants/blocks'

/** The component of the `testimonials` block, whose `items` are the testimonials. */
const BLOCK_COMPONENT = 'section.testimonials'

/** A testimonial rating a save refuses, with where it is. */
export interface RatingViolation {
  /** The dynamic zone that holds the block. */
  zone: string
  /** The block's position in its zone, from 0. */
  position: number
  /** The `id` of the block in the catalogue. */
  block: 'testimonials'
  /** The testimonial's position in the block's `items`, from 0. */
  item: number
  /** The rating as written. */
  rating: unknown
  /** The lowest rating allowed. */
  min: number
  /** The highest rating allowed. */
  max: number
}

/**
 * The first testimonial whose `rating` is not a whole number from 1 to 5.
 *
 * @remarks
 * `null` and an absent field are no rating and are not checked. Strapi checks `max` on every save and
 * `min` only on publish, so the draft check is this one. Only `testimonials` blocks are looked at.
 *
 * @param zones - The dynamic zones of the save by attribute name, each a list of components.
 */
export function findRatingViolation(
  zones: Readonly<Record<string, readonly unknown[]>>
): RatingViolation | null {
  const { min, max } = TESTIMONIAL_RATING_RANGE
  for (const [zone, components] of Object.entries(zones)) {
    for (const [position, component] of components.entries()) {
      if (typeof component !== 'object' || component === null) continue
      const content = component as Record<string, unknown>
      if (content.__component !== BLOCK_COMPONENT || !Array.isArray(content.items)) continue
      for (const [item, testimonial] of (content.items as unknown[]).entries()) {
        if (typeof testimonial !== 'object' || testimonial === null) continue
        const rating = (testimonial as Record<string, unknown>).rating
        if (rating === null || rating === undefined) continue
        if (
          typeof rating !== 'number' ||
          !Number.isInteger(rating) ||
          rating < min ||
          rating > max
        ) {
          return { zone, position, block: 'testimonials', item, rating, min, max }
        }
      }
    }
  }
  return null
}
