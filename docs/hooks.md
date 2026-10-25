# Hooks

<!-- Generated from server/src/types/hooks.ts and server/src/types/extensions.ts by `npm run reference`. Do not edit by hand. -->

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
| [`blockCatalogueChanged`](#blockcataloguechanged) | [`BlockCatalogueChangedPayload`](#blockcataloguechangedpayload) | Runs at boot when the block catalogue differs from the one the instance last booted with.                                                  |

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

Runs at boot when the block catalogue differs from the one the instance last booted with.

The catalogue (`contract/blocks.ts`, ADR-0018) changes only with a new version of the plugin,
so the hook runs once, at the end of the bootstrap, for each change. On a fresh instance, or one
upgraded from a version without the catalogue, every block is `added`. It never runs per site:
the catalogue is the same for every site. Several instances booting at once against one
database may each run it.

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

## Extension points

How a plugin appears in the Micelio admin and in the site archive (ADR-0017): a page in the sub-navigation, a section on every site, checks in the Status page and files in the archive. The how-to for plugin authors is [plugins/extension-points.md](plugins/extension-points.md).

The extension points: `strapi.plugin('micelio').service('extensions')`.

Adding an extension point is a MINOR of the core; removing or renaming one, or changing what a
registration means, is a MAJOR (section 6 of the standard).

- Register in your plugin's `register`, with `strapi.plugin('micelio').service('extensions')`: the
  service exists from the start, whatever the order Strapi registers plugins in. Status checks,
  admin pages and export sections may also be registered in `bootstrap`; a site section may
  not, because the database models are built after `register`.
- Every registration is keyed by `id` and refused when the `id` is taken, with a `TypeError`
  that says so. A registration is validated when it is made, so the plugin fails at boot, not
  in front of an editor.
- Everything is visible only with the registering plugin's `permission`, and nothing runs when
  an admin page loads.

### `registerAdminPage`

```ts
registerAdminPage(page: AdminPageRegistration): void
```

Adds a page of your plugin to the Micelio sub-navigation.

The core lists the item in its group for admin users who have `permission`. The page itself
is provided by your plugin's admin with `apis.registerPage` of the Micelio admin plugin; do
not add a menu link of your own.

Throws `TypeError` when the registration is malformed, its `id` or `to` is taken, or `to` is a path
the core reserves.

```ts
strapi
  .plugin('micelio')
  .service('extensions')
  .registerAdminPage({
    id: 'fediverse',
    group: 'site',
    label: { en: 'Fediverse', es: 'Fediverso' },
    to: 'fediverse',
    permission: 'plugin::fediverse.read',
  })
```

### `registerSiteSection`

```ts
registerSiteSection(section: SiteSectionRegistration): void
```

Attaches your plugin's component to every site.

The core adds `component` to `plugin::micelio.site` as a non-repeatable component, creates its
instance when a site is created (and for the sites that exist when the section is first
registered), and answers it with the site in `GET /micelio/sites` for callers who have
`permission`.

Throws `TypeError` when the registration is malformed, its `id` is taken, the component is
not in Strapi's registry or the database models are already built.

### `registerStatusChecks`

```ts
registerStatusChecks(checks: StatusChecksRegistration): void
```

Adds checks of your plugin to the Status page.

The core runs them for every site on "Run again" and on the daily refresh
(`statusRefreshRule`), keeps the latest results, and answers them under
`plugins[<id>].checks` of `GET /micelio/status` for callers who have `permission`. They are
part of "Copy diagnostics" as one line per plugin.

Throws `TypeError` when the registration is malformed or its `id` is taken.

### `registerExportSection`

```ts
registerExportSection(section: ExportSectionRegistration): void
```

Adds a section of your plugin to the site archive.

An export writes its files under `plugins/<id>/` with `version` in the manifest; an import
hands them to `read`. An import of a section nobody registered, or of another major, reports
it as skipped.

Throws `TypeError` when the registration is malformed or its `id` is taken.

### Extension types

#### `LocalisedText`

A text in every locale the admin supports.

The core shows the locale of the admin user and falls back to `en`. A locale left out is
accepted at runtime; `missingLocales` finds it, for the registering plugin's own tests.

| Field | Type     | Description |
| ----- | -------- | ----------- |
| `en`  | `string` |             |
| `es`  | `string` |             |

#### `ExtensionSite`

The site an extension point runs for: plain data, never a Strapi entity.

| Field        | Type     | Description                                               |
| ------------ | -------- | --------------------------------------------------------- |
| `documentId` | `string` | The site's `documentId`, as the `site` of a hook payload. |
| `slug`       | `string` |                                                           |

#### `AdminPageGroup`

Where a sub-navigation item sits.

```ts
export type AdminPageGroup = 'site' | 'content' | 'overview'
```

#### `AdminPageRegistration`

A page of a sibling plugin in the Micelio sub-navigation.

| Field        | Type             | Description                                                                                                                                                 |
| ------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | `string`         | Unique among pages: lower case letters, digits and hyphens, such as `fediverse`.                                                                            |
| `group`      | `AdminPageGroup` |                                                                                                                                                             |
| `label`      | `LocalisedText`  |                                                                                                                                                             |
| `to`         | `string`         | The page's path under `/plugins/micelio/`, such as `fediverse`: lower case letters, digits, hyphens and `/`. `about` is the core's own page and is refused. |
| `permission` | `string`         | The admin permission that shows the item, such as `plugin::fediverse.read`. The core never widens it: the item is hidden from a role without it.            |

#### `SiteSectionRegistration`

A per-site settings section of a sibling plugin.

| Field        | Type            | Description                                                                                                                                                                                                         |
| ------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | `string`        | Unique among sections: lower case letters, digits and hyphens.                                                                                                                                                      |
| `component`  | `string`        | The UID of the plugin's component, `<category>.<name>`, already in Strapi's registry when this is called. The core adds it to `plugin::micelio.site` as a non-repeatable component, so every site has one instance. |
| `label`      | `LocalisedText` |                                                                                                                                                                                                                     |
| `panel`      | `string`        | The name of the panel the plugin's admin offers for the site view. The core keeps and answers it with the section; the Sites view that renders it under the core fields is a separate piece of the admin.           |
| `permission` | `string`        | The admin permission that reads the section: the section travels with the site in `GET /micelio/sites` only for a caller who has it.                                                                                |

#### `Check`

The result of one status check.

| Field    | Type                       | Description                                     |
| -------- | -------------------------- | ----------------------------------------------- |
| `id`     | `string`                   | Unique within the plugin's checks for one site. |
| `title`  | `LocalisedText`            |                                                 |
| `status` | `'ok' \| 'warn' \| 'fail'` |                                                 |
| `detail` | `LocalisedText`            | What was found.                                 |
| `fix`    | `LocalisedText`            | What to do about a `warn` or a `fail`.          |

#### `StatusChecksRegistration`

A group of status checks of a sibling plugin, shown as one card in the Status page.

| Field        | Type                                                    | Description                                                                                                                                                                                                                                                                                               |
| ------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | `string`                                                | Unique among status checks: lower case letters, digits and hyphens.                                                                                                                                                                                                                                       |
| `label`      | `LocalisedText`                                         |                                                                                                                                                                                                                                                                                                           |
| `permission` | `string`                                                | The admin permission that shows the card and its results in the status response.                                                                                                                                                                                                                          |
| `run`        | `run(site: ExtensionSite): Promise<Check[]> \| Check[]` | Runs the plugin's checks for one site. Called for every site, on "Run again" and on the daily refresh, never when the page loads. A call that throws or takes more than 10 seconds is reported as a failed check of the plugin and logged. It runs outside any request: it must not assume an admin user. |

#### `ExportEntry`

A file of a plugin's section of the archive.

| Field  | Type                   | Description                                                                                                       |
| ------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `path` | `string`               | The path under `plugins/<id>/`: lower case ASCII letters, digits, `.`, `_` and `-`, in segments separated by `/`. |
| `body` | `Uint8Array \| string` | The file's bytes; a string is written as UTF-8.                                                                   |

#### `SectionImportReport`

What a section's `read` did, for the import report.

| Field      | Type     | Description          |
| ---------- | -------- | -------------------- |
| `imported` | `number` | Entries it wrote.    |
| `skipped`  | `number` | Entries it left out. |

#### `ExportSectionRegistration`

A plugin's section of the site archive (`docs/export-format.md`, "Plugin sections").

| Field          | Type                                                                              | Description                                                                                                                                                                                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | `string`                                                                          | Unique among sections: lower case letters, digits and hyphens. The archive folder is `plugins/<id>/`.                                                                                                                                                                                                                        |
| `version`      | `string`                                                                          | The section's format, `major.minor`, written in the manifest. An import skips a section whose major differs from the registered one.                                                                                                                                                                                         |
| `personalData` | `boolean`                                                                         | Whether the section holds personal data that the site does not show. Such a section is left out of an export unless it is asked for by `id` (`micelio export --include <id>`), and every export that includes it is logged.                                                                                                  |
| `permission`   | `string`                                                                          | The admin permission that manages the section. A caller that has an admin user (the export dialog) must check it before it asks for the section; the CLI has no user.                                                                                                                                                        |
| `write`        | `write(site: ExtensionSite): AsyncIterable<ExportEntry>`                          | Writes the section's files for one site, in any order; the archive sorts them. Called while the archive is built, only when the section is included. The core adds the files to the manifest with their sizes and SHA-256.                                                                                                   |
| `read`         | `read(site: ExtensionSite, entries: ExportEntry[]): Promise<SectionImportReport>` | Reads the section's files into the target site. Called by an import of an archive that holds the section, inside the import's database transaction and after the core's content is written: a throw refuses the whole import (`exportSectionFailed`) and rolls everything back. `entries` are verified against the manifest. |
