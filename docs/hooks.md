# Hooks

<!-- Generated from server/src/types/hooks.ts by `npm run reference`. Do not edit by hand. -->

The hooks other plugins use to react to content without touching the core (ADR-0017, section 5): react to an editorial transition, a publication or a new site here, not to `publishedAt`, Strapi lifecycles or the `entry.publish` event.

The hooks, each with the payload its handlers receive.

Adding a hook is a MINOR of the core; removing or renaming one, or changing its payload, is a
MAJOR (section 6 of the standard). A payload is plain data, never a Strapi entity: read the
entry with the document service when a handler needs more.

## Registering a handler

The hooks API: `strapi.plugin('micelio').hooks`, also `strapi.plugin('micelio').service('hooks')`.

- Subscribe in your plugin's `register`, so no event of the boot is missed (the default site is
  created in Micelio's `bootstrap`). Strapi does not order plugins by dependency, so in a
  `register` that may run before Micelio's use `strapi.plugin('micelio').service('hooks')`: it is
  the same object and exists from the start. `strapi.plugin('micelio').hooks` exists once
  Micelio's `register` has run.
- Handlers of a hook run one at a time, in the order they were registered, and each is awaited
  before the next starts. The caller (a transition, a site's creation) waits for all of them.
- Every handler gets the same payload, frozen.
- Handlers run outside the transition: a write of theirs to an editorial entry meets the guard
  like any other, and a transition they perform runs its own hooks.
- A `before` handler that throws stops the operation (see `beforeTransition`). An `after` handler
  that throws is logged with the hook's name and the handlers after it still run; what already
  happened is not undone.

### `on`

```ts
on<K extends HookName>(name: K, handler: HookHandler<K>): () => void
```

Registers a handler for a hook.

Returns a function that removes this handler.

Throws `TypeError` when `name` is not a hook or `handler` is not a function.

```ts
strapi
  .plugin('micelio')
  .service('hooks')
  .on('afterPublish', async ({ site, type, documentId }) => {
    strapi.log.info(`${type} ${documentId} is live on ${site}`)
  })
```

## Hooks

| Hook                                              | Payload                                                         | When                                                                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`beforeTransition`](#beforetransition)           | [`TransitionPayload`](#transitionpayload)                       | Runs before an editorial transition writes anything, once the transition exists, the site's policy allows it and its `publishAt` is valid. |
| [`afterTransition`](#aftertransition)             | [`TransitionPayload`](#transitionpayload)                       | Runs after every editorial transition, the scheduler's included, once the entry is saved in its new state.                                 |
| [`afterPublish`](#afterpublish)                   | [`EntryPayload`](#entrypayload)                                 | Runs after an entry's version goes live: today, after `in_review → published` and `scheduled → published`, following `afterTransition`.    |
| [`afterUnpublish`](#afterunpublish)               | [`EntryPayload`](#entrypayload)                                 | Runs after an entry's published version is taken down (`published → draft`), following `afterTransition`.                                  |
| [`siteCreated`](#sitecreated)                     | [`SiteCreatedPayload`](#sitecreatedpayload)                     | Runs after a site is created, by the admin, the document service or the boot step that creates the default site on an empty instance.      |
| [`blockCatalogueChanged`](#blockcataloguechanged) | [`BlockCatalogueChangedPayload`](#blockcataloguechangedpayload) | Runs after the block catalogue changes.                                                                                                    |

### `beforeTransition`

Runs before an editorial transition writes anything, once the transition exists, the site's
policy allows it and its `publishAt` is valid.

A handler refuses the transition by throwing: nothing is written, the handlers after it do not
run, and the caller gets a `TransitionError` with the code `editorialTransitionRefused` (409)
whose message is the handler's. `POST /micelio/transitions` answers it as a problem detail.

Payload: [`TransitionPayload`](#transitionpayload).

### `afterTransition`

Runs after every editorial transition, the scheduler's included, once the entry is saved in
its new state.

Payload: [`TransitionPayload`](#transitionpayload).

### `afterPublish`

Runs after an entry's version goes live: today, after `in_review → published` and
`scheduled → published`, following `afterTransition`.

Treat it as "this version is now live", not "first publication": bogd3v/micelio#699 adds a
transition that puts the edits of a published entry live, and this hook fires for it too. A
handler that publishes elsewhere (the fediverse, a static rebuild) must be idempotent per
`documentId` and `locale`.

Payload: [`EntryPayload`](#entrypayload).

### `afterUnpublish`

Runs after an entry's published version is taken down (`published → draft`), following
`afterTransition`.

Payload: [`EntryPayload`](#entrypayload).

### `siteCreated`

Runs after a site is created, by the admin, the document service or the boot step that
creates the default site on an empty instance.

Payload: [`SiteCreatedPayload`](#sitecreatedpayload).

### `blockCatalogueChanged`

Runs after the block catalogue changes.

The catalogue and the moment it changes belong to bogd3v/micelio-plugin-core#4; until it lands,
nothing emits this hook. The catalogue is the same for every site (ADR-0018).

Payload: [`BlockCatalogueChangedPayload`](#blockcataloguechangedpayload).

## Types

### `HookActor`

Who performed a transition: an admin user, or the plugin itself (the scheduler).

`id` is the admin user's id. Their roles are not part of the payload.

```ts
export type HookActor = { kind: 'user'; id: number } | { kind: 'system' }
```

### `TransitionPayload`

An editorial transition of one entry, before or after it happens.

| Field        | Type             | Description                                                                                                                                                            |
| ------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site`       | `string \| null` | The `documentId` of the entry's site. `null` only for a type made with `withEditorial` but without `withSiteScope`.                                                    |
| `type`       | `string`         | The UID of the entry's content type, such as `api::article.article`.                                                                                                   |
| `documentId` | `string`         |                                                                                                                                                                        |
| `locale`     | `string \| null` | The locale that moves: publishing in Strapi is per locale. `null` for a type without i18n.                                                                             |
| `from`       | `EditorialState` |                                                                                                                                                                        |
| `to`         | `EditorialState` |                                                                                                                                                                        |
| `publishAt`  | `string \| null` | The entry's `publishAt` once the transition is done, as an ISO 8601 date: set by a move to `scheduled`, kept by `scheduled → published`, cleared by a move to `draft`. |
| `actor`      | `HookActor`      |                                                                                                                                                                        |

### `EntryPayload`

An entry whose published version just appeared, changed or disappeared.

| Field        | Type             | Description                                                                  |
| ------------ | ---------------- | ---------------------------------------------------------------------------- |
| `site`       | `string \| null` | The `documentId` of the entry's site; `null` as in `TransitionPayload.site`. |
| `type`       | `string`         | The UID of the entry's content type.                                         |
| `documentId` | `string`         |                                                                              |
| `locale`     | `string \| null` | The locale published or unpublished; `null` for a type without i18n.         |
| `actor`      | `HookActor`      |                                                                              |

### `SiteCreatedPayload`

A site that was just created.

| Field       | Type      | Description                               |
| ----------- | --------- | ----------------------------------------- |
| `site`      | `string`  | The new site's `documentId`.              |
| `slug`      | `string`  |                                           |
| `isDefault` | `boolean` | Whether the new site is the default site. |

### `BlockCatalogueChangedPayload`

What changed in the block catalogue (ADR-0018), by block id.

| Field     | Type       | Description                                                                  |
| --------- | ---------- | ---------------------------------------------------------------------------- |
| `added`   | `string[]` | Ids of the blocks that joined the catalogue.                                 |
| `changed` | `string[]` | Ids of the blocks whose schema, options, cost or static alternative changed. |
| `removed` | `string[]` | Ids of the blocks that left the catalogue.                                   |

### `HookName`

The name of a hook.

```ts
export type HookName = keyof HookPayloads
```

### `HookHandler`

A function that handles a hook; Micelio awaits it.

```ts
export type HookHandler<K extends HookName> = (payload: Readonly<HookPayloads[K]>) => unknown
```
