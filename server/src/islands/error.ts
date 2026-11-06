import { errors } from '@strapi/utils'
import { SCENE_BACKGROUND_LIMIT_CODE } from '../constants/blocks'
import type { BackgroundSceneExcess } from './rules'

/**
 * A save refused because a zone holds more background Scenes than a page may.
 *
 * @remarks
 * Strapi answers it as a `ValidationError` (400) where the route has no middleware to say better;
 * the `site-scope` route middleware turns it into the problem detail `docs/api.md` describes.
 */
export class SceneBackgroundLimitError extends errors.ValidationError {
  constructor(readonly excess: BackgroundSceneExcess) {
    const { block, count, limit } = excess
    super(
      `A page may hold ${limit} ${block} block with variant background, and this one has ${count}`,
      { code: SCENE_BACKGROUND_LIMIT_CODE, block, count, limit }
    )
  }
}
