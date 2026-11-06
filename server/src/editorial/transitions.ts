import type { Core, UID } from '@strapi/strapi'
import {
  EDITORIAL_ATTRIBUTE,
  EDITORIAL_NOTE_MAX_LENGTH,
  LINK_TO_DRAFT,
  type EditorialState,
} from '../constants/editorial'
import { SLUG_ATTRIBUTE } from '../constants/page-settings'
import type { BudgetService } from '../services/budget'
import { hooksOf } from '../hooks'
import { findMissingAlternativesIn } from '../islands/check'
import { ISLAND_ALTERNATIVE_MISSING } from '../constants/blocks'
import { hasPageSettings } from '../page-settings'
import { findSampleTextIn } from '../page-templates/check'
import { SAMPLE_TEXT_PRESENT } from '../constants/page-templates'
import { recordSlugChange, type SlugChange } from '../page-settings/record'
import { SITE_ATTRIBUTE } from '../site-scope'
import type { EntryPayload, TransitionPayload } from '../types/hooks'
import { isEditorial } from '.'
import { runAsTransition } from './context'
import { findLinksToDraftsIn, type LinkToDraft } from './links'
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
  /**
   * A note for the next person, stored as the component's `note` until the next transition: what
   * changed for the reviewer, or why a reviewer sends the page back. Omitted or blank: none.
   */
  note?: string
  /**
   * Run every check and answer what the transition would do, without writing anything or running
   * the hooks: the send to review dialog of the builder shows its warnings before the editor sends.
   */
  dryRun?: boolean
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
  /** What the transition let through but the editor should know; empty when nothing. */
  warnings: TransitionWarning[]
}

/**
 * A warning of a transition, in the shape of a problem detail (section 4 of the standard) with no
 * HTTP status: the transition is not refused.
 */
export interface TransitionWarning {
  type: 'about:blank'
  title: string
  code: typeof LINK_TO_DRAFT
  detail: string
  /** `linkToDraft`: each link, its block and the page it points to. */
  blocks: LinkToDraft[]
}

/** Why a transition was refused, as the `code` of its problem detail. */
export type TransitionErrorCode =
  | 'editorialRequestInvalid'
  | 'editorialTypeInvalid'
  | 'editorialEntryNotFound'
  | 'editorialTransitionInvalid'
  | 'editorialTransitionForbidden'
  | 'editorialPublishAtInvalid'
  | 'editorialTransitionRefused'
  | 'islandAlternativeMissing'
  | 'sampleTextPresent'
  | 'pageOverBudget'
  | 'previewUnavailable'

/** A refused transition, with the HTTP status and code it answers. */
export class TransitionError extends Error {
  constructor(
    readonly status: number,
    readonly code: TransitionErrorCode,
    message: string,
    /** Members the problem detail carries besides the standard ones (`pageOverBudget`: the blocks and the excess). */
    readonly extensions: Record<string, unknown> = {}
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
  slug?: unknown
}

/**
 * Moves an entry from its editorial state to another (ADR-0017, section 5).
 *
 * @remarks
 * The transition must exist in the state machine, the actor must be allowed by the policy of the
 * entry's site, and `isPermitted` must agree. Moving to `published` is the one call that publishes
 * the entry in Strapi, and moving from `published` to `draft` the one that unpublishes it: the
 * editorial state never contradicts `publishedAt`. `published -> published` (republish) puts the
 * entry's current draft live over the published version with one `publish`, never unpublishing
 * first, so a reader of the content API always gets a published version; it sets `publishedBy` to
 * the republisher and leaves `reviewedBy` alone. `reviewedBy` records the user who moved the
 * entry out of `in_review`, and `publishedBy` the one who published it (empty for the scheduler).
 *
 * Moving to `published` an entry of a measured type (`budgets.contentTypes`, by default `page` and
 * `article`, when it is site-scoped, editorial and has a dynamic zone) first has the frontend
 * measure its draft, through the `budget` service, and refuses with `pageOverBudget` above the
 * budget of its page type, or `previewUnavailable` when the measurement fails. It never publishes
 * without the measurement. Right before the write it checks that the draft was not saved since, and
 * refuses with `previewUnavailable` when it was.
 *
 * Moving an entry out of `draft` first checks that every island block of its draft has its static
 * alternative filled in (`alternative` in `contract/blocks.ts`) and refuses with
 * `islandAlternativeMissing`, naming the blocks, their positions and the empty fields. Moving back
 * to `draft` and the scheduler's `scheduled -> published` are not checked.
 *
 * Publishing, or scheduling the publish of, a page created from a template (`docs/guide/templates.md`)
 * first checks that none of the sample texts it copied is left in its draft, and refuses with
 * `sampleTextPresent`, naming the blocks and fields. The scheduler's own `scheduled -> published`
 * runs the check again, so a page whose draft regained a sample text stays scheduled. A page that
 * holds no sample text, or none made from a template, is not checked; review and moving back to
 * `draft` are not either.
 *
 * Publishing a page type made with `withPageSettings` whose slug differs from the live one writes
 * the redirect from the old address in the same transaction as the publish (`docs/guide/pages.md`):
 * either both stand or neither does. A draft's slug changes no URL.
 *
 * Moving a user's entry out of `draft` or to `published` (any move but back to `draft`) also looks
 * for links of its draft to pages of the same site that have no published version and answers them
 * as the warning `linkToDraft`, naming each block; it is not refused. The note of the request is
 * stored as the component's `note`, replacing the previous one; a move without one clears it.
 * `dryRun` stops after the checks and the measurement, before the hooks and any write.
 *
 * It runs the hooks of the transition (`docs/hooks.md`): `beforeTransition` once every check has
 * passed and before anything is written, then `afterTransition` and, when the entry was published
 * (a republish included) or unpublished, `afterPublish` or `afterUnpublish`. Every caller, the scheduler included, fires
 * them by calling this function.
 *
 * @throws {@link TransitionError} when the transition is refused, with its status and code.
 */
export async function performTransition(
  strapi: Core.Strapi,
  request: TransitionRequest
): Promise<TransitionResult> {
  const uid = request.uid as UID.ContentType
  const note = request.note?.trim() || null
  if (note !== null && note.length > EDITORIAL_NOTE_MAX_LENGTH) {
    throw new TransitionError(
      400,
      'editorialRequestInvalid',
      `The note is longer than ${EDITORIAL_NOTE_MAX_LENGTH} characters`
    )
  }
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
  // A page goes to review, is scheduled or is published with the static alternative of each island
  // filled in: it is what a visitor gets before the island loads and what a static build and a feed
  // carry. Moving back to draft is not checked, and the scheduler's own move was checked when the
  // page was scheduled.
  if (request.to !== 'draft' && transition.from !== 'scheduled') {
    const missing = await findMissingAlternativesIn(strapi, {
      uid,
      documentId: entry.documentId,
      locale: entry.locale,
    })
    if (missing.length > 0) {
      throw new TransitionError(
        409,
        ISLAND_ALTERNATIVE_MISSING,
        `The static alternative of ${missing.map(describeMissing).join(', ')} is not filled in`,
        { blocks: missing }
      )
    }
  }
  // A page made from a template publishes once the sample text it copied is replaced.
  if (request.to === 'published' || request.to === 'scheduled') {
    const samples = await findSampleTextIn(strapi, {
      uid,
      documentId: entry.documentId,
      locale: entry.locale,
    })
    if (samples.length > 0) {
      throw new TransitionError(
        409,
        SAMPLE_TEXT_PRESENT,
        `The sample text of ${samples.map(describeSample).join(', ')} is not replaced`,
        { blocks: samples }
      )
    }
  }
  const warnings: TransitionWarning[] = []
  if (request.to !== 'draft' && request.actor.kind === 'user') {
    const links = await findLinksToDraftsIn(strapi, {
      uid,
      documentId: entry.documentId,
      locale: entry.locale,
      site: entry.site?.documentId ?? null,
    })
    if (links.length > 0) warnings.push(linkWarning(links))
  }
  const userId = request.actor.kind === 'user' ? request.actor.id : null
  const editorial = {
    state: transition.to,
    publishAt,
    reviewedBy:
      transition.from === 'in_review' ? userId : (entry.editorial?.reviewedBy?.id ?? null),
    publishedBy:
      transition.to === 'published' ? userId : (entry.editorial?.publishedBy?.id ?? null),
    note,
  }
  const target = { documentId: entry.documentId, locale: entry.locale ?? undefined }
  const payload: TransitionPayload = {
    site: entry.site?.documentId ?? null,
    type: request.uid,
    documentId: entry.documentId,
    locale: entry.locale ?? null,
    from: transition.from,
    to: transition.to,
    publishAt,
    actor:
      request.actor.kind === 'user' ? { kind: 'user', id: request.actor.id } : { kind: 'system' },
  }
  // Every check of the policy has passed; what remains is what the frontend says the page weighs.
  const budget = strapi.plugin('micelio').service('budget') as BudgetService
  const measured =
    transition.to === 'published' && budget.applies(request.uid)
      ? await budget.assertWithinBudget({
          uid: request.uid,
          documentId: entry.documentId,
          locale: entry.locale,
        })
      : null
  const result: TransitionResult = {
    uid: request.uid,
    documentId: entry.documentId,
    locale: entry.locale ?? null,
    from: transition.from,
    to: transition.to,
    site: entry.site?.documentId ?? null,
    warnings,
  }
  if (request.dryRun) return result
  const hooks = hooksOf(strapi)
  try {
    await hooks.runBefore('beforeTransition', payload)
  } catch (error) {
    throw new TransitionError(409, 'editorialTransitionRefused', refusalMessage(error))
  }

  if (measured) {
    await budget.assertUnchanged(measured, {
      uid: request.uid,
      documentId: entry.documentId,
      locale: entry.locale,
    })
  }
  const slugChange =
    transition.to === 'published' && hasPageSettings(strapi.contentType(uid))
      ? await slugChangeOf(strapi, uid, entry)
      : null
  // One transaction: a redirect that cannot be written leaves the page at its live address.
  await strapi.db.transaction(() =>
    runAsTransition(async () => {
      // A republish never unpublishes: the live version stays until the one `publish` replaces it.
      if (transition.from === 'published' && transition.to !== 'published') {
        await documents.unpublish(target as never)
      }
      await documents.update({ ...target, data: { [EDITORIAL_ATTRIBUTE]: editorial } } as never)
      if (transition.to === 'published') await documents.publish(target as never)
      if (slugChange) await recordSlugChange(strapi, slugChange)
    })
  )

  await hooks.runAfter('afterTransition', payload)
  const live: EntryPayload = {
    site: payload.site,
    type: payload.type,
    documentId: payload.documentId,
    locale: payload.locale,
    actor: payload.actor,
  }
  if (transition.to === 'published') await hooks.runAfter('afterPublish', live)
  else if (transition.from === 'published') await hooks.runAfter('afterUnpublish', live)

  return result
}

function linkWarning(links: LinkToDraft[]): TransitionWarning {
  const pages = [...new Set(links.map((link) => link.page.title))].join(', ')
  return {
    type: 'about:blank',
    title: 'Link to a draft page',
    code: LINK_TO_DRAFT,
    detail: `${links.length} ${links.length === 1 ? 'link points' : 'links point'} to a page that is not published (${pages}); it answers 404 until that page is published`,
    blocks: links,
  }
}

function describeSample(found: { block: string; position: number; fields: string[] }): string {
  return `the ${found.block} block at position ${found.position + 1} (${found.fields.join(', ')})`
}

function describeMissing(missing: { block: string; position: number; fields: string[] }): string {
  return `the ${missing.block} block at position ${missing.position + 1} (${missing.fields.join(', ')})`
}

/** The change of address the publish of `entry` makes, or `null` when no version is live or the slug stays. */
async function slugChangeOf(
  strapi: Core.Strapi,
  uid: UID.ContentType,
  entry: EditorialEntry
): Promise<SlugChange | null> {
  const live = (await strapi.documents(uid).findOne({
    documentId: entry.documentId,
    locale: entry.locale ?? undefined,
    status: 'published',
  } as never)) as { slug?: unknown } | null
  const to = entry[SLUG_ATTRIBUTE as 'slug']
  const from = live?.[SLUG_ATTRIBUTE as 'slug']
  if (!entry.site || typeof from !== 'string' || typeof to !== 'string') return null
  if (from === '' || to === '' || from === to) return null
  return { site: entry.site.documentId, locale: entry.locale ?? null, from, to }
}

function refusalMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message === '' ? 'A beforeTransition handler refused the transition' : message
}
