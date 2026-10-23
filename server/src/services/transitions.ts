import type { Core } from '@strapi/strapi'
import {
  performTransition,
  type TransitionRequest,
  type TransitionResult,
} from '../editorial/transitions'

/**
 * The `transitions` service: `strapi.plugin('micelio').service('transitions')`.
 *
 * @remarks
 * The one way to move an editorial entry, and so to publish or unpublish it. It refuses with a
 * `TransitionError` (see `performTransition`).
 */
export interface TransitionsService {
  /** Performs a transition; see `performTransition`. */
  perform(request: TransitionRequest): Promise<TransitionResult>
}

export default ({ strapi }: { strapi: Core.Strapi }): TransitionsService => ({
  perform(request) {
    return performTransition(strapi, request)
  },
})
