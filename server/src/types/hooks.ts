// The plugin hooks API: a contract of section 6 of the standard. `docs/hooks.md` is generated from
// the TSDoc of this file (`npm run reference`), and `npm run lint:reference` fails when it drifts.

import type { EditorialState } from '../constants/editorial'

/**
 * Who performed a transition: an admin user, or the plugin itself (the scheduler).
 *
 * @remarks
 * `id` is the admin user's id. Their roles are not part of the payload.
 */
export type HookActor = { kind: 'user'; id: number } | { kind: 'system' }

/** An editorial transition of one entry, before or after it happens. */
export interface TransitionPayload {
  /**
   * The `documentId` of the entry's site. `null` only for a type made with `withEditorial` but
   * without `withSiteScope`.
   */
  site: string | null
  /** The UID of the entry's content type, such as `api::article.article`. */
  type: string
  documentId: string
  /** The locale that moves: publishing in Strapi is per locale. `null` for a type without i18n. */
  locale: string | null
  from: EditorialState
  to: EditorialState
  /**
   * The entry's `publishAt` once the transition is done, as an ISO 8601 date: set by a move to
   * `scheduled`, kept by `scheduled → published`, cleared by a move to `draft`.
   */
  publishAt: string | null
  actor: HookActor
}

/** An entry whose published version just appeared, changed or disappeared. */
export interface EntryPayload {
  /** The `documentId` of the entry's site; `null` as in {@link TransitionPayload.site}. */
  site: string | null
  /** The UID of the entry's content type. */
  type: string
  documentId: string
  /** The locale published or unpublished; `null` for a type without i18n. */
  locale: string | null
  actor: HookActor
}

/** A site that was just created. */
export interface SiteCreatedPayload {
  /** The new site's `documentId`. */
  site: string
  slug: string
  /** Whether the new site is the default site. */
  isDefault: boolean
}

/** What changed in the block catalogue (ADR-0018), by block id. */
export interface BlockCatalogueChangedPayload {
  /** Ids of the blocks that joined the catalogue. */
  added: string[]
  /** Ids of the blocks whose schema, options, cost or static alternative changed. */
  changed: string[]
  /** Ids of the blocks that left the catalogue. */
  removed: string[]
}

/**
 * The hooks, each with the payload its handlers receive.
 *
 * @remarks
 * Adding a hook is a MINOR of the core; removing or renaming one, or changing its payload, is a
 * MAJOR (section 6 of the standard). A payload is plain data, never a Strapi entity: read the
 * entry with the document service when a handler needs more.
 */
export interface HookPayloads {
  /**
   * Runs before an editorial transition writes anything, once the transition exists, the site's
   * policy allows it and its `publishAt` is valid.
   *
   * @remarks
   * A handler refuses the transition by throwing: nothing is written, the handlers after it do not
   * run, and the caller gets a `TransitionError` with the code `editorialTransitionRefused` (409)
   * whose message is the handler's. `POST /micelio/transitions` answers it as a problem detail.
   */
  beforeTransition: TransitionPayload
  /**
   * Runs after every editorial transition, the scheduler's included, once the entry is saved in
   * its new state.
   */
  afterTransition: TransitionPayload
  /**
   * Runs after an entry's version goes live: today, after `in_review → published` and
   * `scheduled → published`, following `afterTransition`.
   *
   * @remarks
   * Treat it as "this version is now live", not "first publication": bogd3v/micelio#699 adds a
   * transition that puts the edits of a published entry live, and this hook fires for it too. A
   * handler that publishes elsewhere (the fediverse, a static rebuild) must be idempotent per
   * `documentId` and `locale`.
   */
  afterPublish: EntryPayload
  /**
   * Runs after an entry's published version is taken down (`published → draft`), following
   * `afterTransition`.
   */
  afterUnpublish: EntryPayload
  /**
   * Runs after a site is created, by the admin, the document service or the boot step that
   * creates the default site on an empty instance.
   */
  siteCreated: SiteCreatedPayload
  /**
   * Runs at boot when the block catalogue differs from the one the instance last booted with.
   *
   * @remarks
   * The catalogue (`contract/blocks.ts`, ADR-0018) changes only with a new version of the plugin,
   * so the hook runs once, at the end of the bootstrap, for each change. On a fresh instance, or one
   * upgraded from a version without the catalogue, every block is `added`. It never runs per site:
   * the catalogue is the same for every site. Several instances booting at once against one
   * database may each run it.
   */
  blockCatalogueChanged: BlockCatalogueChangedPayload
}

/** The name of a hook. */
export type HookName = keyof HookPayloads

/** A function that handles a hook; Micelio awaits it. */
export type HookHandler<K extends HookName> = (payload: Readonly<HookPayloads[K]>) => unknown

/**
 * The hooks API: `strapi.plugin('micelio').hooks`, also `strapi.plugin('micelio').service('hooks')`.
 *
 * @remarks
 * - Subscribe in your plugin's `register`, so no event of the boot is missed (the default site is
 *   created in Micelio's `bootstrap`). Strapi does not order plugins by dependency, so in a
 *   `register` that may run before Micelio's use `strapi.plugin('micelio').service('hooks')`: it is
 *   the same object and exists from the start. `strapi.plugin('micelio').hooks` exists once
 *   Micelio's `register` has run.
 * - Handlers of a hook run one at a time, in the order they were registered, and each is awaited
 *   before the next starts. The caller (a transition, a site's creation) waits for all of them.
 * - Every handler gets the same payload, frozen.
 * - Handlers run outside the transition: a write of theirs to an editorial entry meets the guard
 *   like any other, and a transition they perform runs its own hooks.
 * - A `before` handler that throws stops the operation (see `beforeTransition`). An `after` handler
 *   that throws is logged with the hook's name and the handlers after it still run; what already
 *   happened is not undone.
 */
export interface MicelioHooks {
  /**
   * Registers a handler for a hook.
   *
   * @returns A function that removes this handler.
   * @throws `TypeError` when `name` is not a hook or `handler` is not a function.
   *
   * @example
   * ```ts
   * strapi.plugin('micelio').service('hooks').on('afterPublish', async ({ site, type, documentId }) => {
   *   strapi.log.info(`${type} ${documentId} is live on ${site}`)
   * })
   * ```
   */
  on<K extends HookName>(name: K, handler: HookHandler<K>): () => void
}
