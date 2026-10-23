import type { Core } from '@strapi/strapi'
import { publishDueEntries } from '../editorial/scheduler'
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
  /** Publishes the scheduled entries that are due, as the scheduler does; see `publishDueEntries`. */
  publishDue(now?: Date): Promise<number>
}

export default ({ strapi }: { strapi: Core.Strapi }): TransitionsService => ({
  perform(request) {
    return performTransition(strapi, request)
  },
  publishDue(now) {
    return publishDueEntries(strapi, now)
  },
})
