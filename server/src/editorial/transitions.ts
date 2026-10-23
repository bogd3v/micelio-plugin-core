import type { Core, UID } from '@strapi/strapi'
import { EDITORIAL_ATTRIBUTE, type EditorialState } from '../constants/editorial'
import { SITE_ATTRIBUTE } from '../site-scope'
import { isEditorial } from '.'
import { runAsTransition } from './context'
import { type Actor, isTransition, mayPerform, parseEditorialPolicy } from './machine'

/** What a transition is asked to do. */
export interface TransitionRequest {
  /** A content type made with `withEditorial`. */
  uid: string
  documentId: string
  /** The locale to move; publishing in Strapi is per locale. Omitted: the default locale. */
  locale?: string
  to: EditorialState
  /** When to publish, in the future. Required to move to `scheduled`, ignored otherwise. */
  publishAt?: string | Date
  actor: Actor
  /**
   * Whether the actor's Strapi permissions let them do this to the entry, besides the site's
   * policy: `publish` for a transition to or from `published`, `update` for the others.
   * Omitted: no check beyond the policy, as for the plugin's own scheduler.
   */
  isPermitted?: (action: 'update' | 'publish', entry: object) => boolean
}

/** What a transition did. */
export interface TransitionResult {
  uid: string
  documentId: string
  locale: string | null
  from: EditorialState
  to: EditorialState
  /** The `documentId` of the entry's site. */
  site: string | null
}

/** Why a transition was refused, as the `code` of its problem detail. */
export type TransitionErrorCode =
  | 'editorialTypeInvalid'
  | 'editorialEntryNotFound'
  | 'editorialTransitionInvalid'
  | 'editorialTransitionForbidden'
  | 'editorialPublishAtInvalid'

/** A refused transition, with the HTTP status and code it answers. */
export class TransitionError extends Error {
  constructor(
    readonly status: number,
    readonly code: TransitionErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'TransitionError'
  }
}

interface EditorialEntry {
  documentId: string
  locale?: string | null
  editorial?: {
    state?: EditorialState
    publishAt?: string | null
    reviewedBy?: { id: number } | null
    publishedBy?: { id: number } | null
  } | null
  site?: { documentId: string; editorialPolicy?: unknown } | null
}

/**
 * Moves an entry from its editorial state to another (ADR-0017, section 5).
 *
 * @remarks
 * The transition must exist in the state machine, the actor must be allowed by the policy of the
 * entry's site, and `isPermitted` must agree. Moving to `published` is the one call that publishes
 * the entry in Strapi, and moving from `published` to `draft` the one that unpublishes it: the
 * editorial state never contradicts `publishedAt`. `reviewedBy` records the user who moved the
 * entry out of `in_review`, and `publishedBy` the one who published it (empty for the scheduler).
 *
 * @throws {@link TransitionError} when the transition is refused, with its status and code.
 */
export async function performTransition(
  strapi: Core.Strapi,
  request: TransitionRequest
): Promise<TransitionResult> {
  const uid = request.uid as UID.ContentType
  if (!isEditorial(strapi.contentType(uid))) {
    throw new TransitionError(
      400,
      'editorialTypeInvalid',
      `${request.uid} has no editorial workflow`
    )
  }
  const documents = strapi.documents(uid)
  const entry = (await documents.findOne({
    documentId: request.documentId,
    locale: request.locale,
    status: 'draft',
    populate: {
      [EDITORIAL_ATTRIBUTE]: { populate: ['reviewedBy', 'publishedBy'] },
      [SITE_ATTRIBUTE]: { fields: ['documentId', 'editorialPolicy'] },
      createdBy: true,
    },
  } as never)) as EditorialEntry | null
  if (!entry) {
    throw new TransitionError(404, 'editorialEntryNotFound', 'There is no such entry')
  }

  const transition = { from: entry.editorial?.state ?? 'draft', to: request.to }
  if (!isTransition(transition)) {
    throw new TransitionError(
      409,
      'editorialTransitionInvalid',
      `An entry cannot move from ${transition.from} to ${transition.to}`
    )
  }
  const policy = parseEditorialPolicy(entry.site?.editorialPolicy)
  const touchesPublished = transition.from === 'published' || transition.to === 'published'
  if (
    !mayPerform(request.actor, transition, 'policy' in policy ? policy.policy : {}) ||
    (request.isPermitted && !request.isPermitted(touchesPublished ? 'publish' : 'update', entry))
  ) {
    throw new TransitionError(
      403,
      'editorialTransitionForbidden',
      `You may not move this entry from ${transition.from} to ${transition.to}`
    )
  }

  let publishAt = entry.editorial?.publishAt ?? null
  if (transition.to === 'scheduled') {
    const at = request.publishAt === undefined ? Number.NaN : new Date(request.publishAt).getTime()
    if (!(at > Date.now())) {
      throw new TransitionError(400, 'editorialPublishAtInvalid', 'publishAt must be in the future')
    }
    publishAt = new Date(at).toISOString()
  } else if (transition.to === 'draft') {
    publishAt = null
  }
  const userId = request.actor.kind === 'user' ? request.actor.id : null
  const editorial = {
    state: transition.to,
    publishAt,
    reviewedBy:
      transition.from === 'in_review' ? userId : (entry.editorial?.reviewedBy?.id ?? null),
    publishedBy:
      transition.to === 'published' ? userId : (entry.editorial?.publishedBy?.id ?? null),
  }
  const target = { documentId: entry.documentId, locale: entry.locale ?? undefined }

  await runAsTransition(async () => {
    if (transition.from === 'published') await documents.unpublish(target as never)
    await documents.update({ ...target, data: { [EDITORIAL_ATTRIBUTE]: editorial } } as never)
    if (transition.to === 'published') await documents.publish(target as never)
  })

  return {
    uid: request.uid,
    documentId: entry.documentId,
    locale: entry.locale ?? null,
    from: transition.from,
    to: transition.to,
    site: entry.site?.documentId ?? null,
  }
}
