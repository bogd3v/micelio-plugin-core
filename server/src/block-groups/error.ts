import { errors } from '@strapi/utils'
import { BLOCK_GROUP_INVALID } from '../constants/blocks'
import type { BlockPlace, GroupViolation } from './rules'

/**
 * A save refused because a group of blocks is split into two runs or its members set two `tone`s
 * (ADR-0022, section 2).
 *
 * @remarks
 * Strapi answers it as a `ValidationError` (400) where the route has no middleware to say better;
 * the `site-scope` route middleware turns it into the problem detail `docs/api.md` describes.
 */
export class BlockGroupError extends errors.ValidationError {
  constructor(readonly violation: GroupViolation) {
    const { reason, groupId, member, between, groupTone, tone } = violation
    const here = `the ${violation.block} block at ${at(violation)}`
    super(
      reason === 'split'
        ? `Not saved: the group "${groupId}" would be split. ` +
            (between
              ? `${capitalised(name(between))}, outside it, sits between ${at(member)} and ${at(violation)}.`
              : `It ends with its zone at ${at(member)} and starts again at ${at(violation)}.`)
        : `Not saved: ${here} sets the tone ${String(tone)} for the group "${groupId}", ` +
            `whose tone is ${String(groupTone)} at ${at(member)}.`,
      { code: BLOCK_GROUP_INVALID, ...violation }
    )
  }
}

function at({ zone, position }: BlockPlace): string {
  return `${zone}.${position}`
}

function name(place: BlockPlace): string {
  return `the ${place.block} block at ${at(place)}`
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
