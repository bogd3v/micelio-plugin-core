# Content API

How the plugin's content API routes behave. Routes keep Strapi's content API format (section 4 of the engineering standard); only the errors the plugin adds are problem details. Every route needs an API token: the plugin grants nothing to the public role.

## Routes

| Method | Path                     | Answers                                             |
| ------ | ------------------------ | --------------------------------------------------- |
| `GET`  | `/api/micelio/sites`     | The sites, in Strapi's list format (`data`, `meta`) |
| `GET`  | `/api/micelio/sites/:id` | One site by `documentId`                            |

The prefix `/micelio` is set explicitly, so a host's own `/api/sites` does not collide with it. The preview routes ([Preview](#preview)) are content API routes too. The two taxonomy types answer at the paths `micelio-cms` already serves ([Category and tag](#category-and-tag)).

## Scoping the routes of a type

A route file of a site-scoped type puts `SITE_SCOPE_MIDDLEWARE` in the `config` of each of its actions. Give every action its own config object:

```js
const scoped = () => ({ middlewares: [SITE_SCOPE_MIDDLEWARE] })

module.exports = factories.createCoreRouter('api::note.note', {
  config: {
    find: scoped(),
    findOne: scoped(),
    create: scoped(),
    update: scoped(),
    delete: scoped(),
  },
})
```

Do not write `const scoped = { middlewares: [...] }` and pass it to all five. Strapi writes each route's `auth.scope` into the config object it is given, so a shared one ends up with the scope of the first action (`api::note.note.find`) on every route, and a custom API token that may only `find` can also `POST`, `PUT` and `DELETE`.

## Which site a request is for

Every content type of a Micelio plugin belongs to one site (ADR-0017, section 4). On the routes of such a type, the site of a request is, in this order:

1. The one whose `slug` the `site` query parameter names: `/api/notes?site=example`.
2. The one whose `hosts` list the host name the request was made to (`X-Forwarded-Host` counts only when the host sets `server.proxy`).
3. The default site (`isDefault`), which keeps a frontend that names no site working unchanged.

Reads answer only that site's entries; reading, changing or deleting another site's entry by its id answers `404`, as if it did not exist; and an entry created through the content API belongs to that site.

A locale added to an entry (by the Content Manager, the content API or an import) that names no site, or leaves the relation as it is, takes the site of the entry's other locales, and is refused with `400` and `site is required` when those locales belong to different sites or none has one. A locale added to an entry that names another site than the one its other locales share is refused with `400` and `site must be the site of the other locales`, as a removal of the site is. The site of a locale that exists may change only when no other locale of the entry stays on another site; otherwise the update is refused with `400` and `site cannot change while other locales of the document stay on another site`, and an entry of a single locale moves freely. Publishing a locale, or discarding the changes of its draft, keeps the site on the version Strapi rebuilds. A request scoped to a site is answered `404` for an entry of another site before any of this.

## Category and tag

The plugin owns `plugin::micelio.category` and `plugin::micelio.tag`, under the UIDs, tables (`categories`, `tags`) and attributes that `micelio-cms` 0.5 already stores (ADR-0017, amendment of 2026-10-26). Their routes have no `/micelio` prefix, so the frontend's requests keep working:

| Method                         | Path                    | Answers                                 |
| ------------------------------ | ----------------------- | --------------------------------------- |
| `GET`                          | `/api/categories`       | The categories of the site, localised   |
| `GET`                          | `/api/categories/:id`   | One category by `documentId`            |
| `POST`, `PUT`, `DELETE`        | `/api/categories[/:id]` | Create, update, delete, with the grants |
| `GET`, `POST`, `PUT`, `DELETE` | `/api/tags[/:id]`       | The same for tags                       |

Both types are site-scoped like any other ([Which site a request is for](#which-site-a-request-is-for)): `?site=<slug>` names the site, and an unknown one answers `unknownSite`. A row a database already holds with no site (the ones `micelio-cms` 0.5 wrote) is given the default site on boot.

- **Grants.** The plugin grants nothing. `READ_ACTIONS` (`plugin::micelio.category.find` and `plugin::micelio.tag.find`), exported by `@micelio/strapi-plugin-core/strapi-server`, is what a host spreads into its token lists; the roles and tokens stay the host's, because plugins bootstrap in no fixed order (ADR-0017, amendment of 2026-10-23). `CATEGORY_UID` and `TAG_UID` are exported too.
- **Older UIDs.** On boot, before any plugin bootstraps, the grants of roles and API tokens, the admin permissions and the Content Manager layouts stored under `api::category.category` and `api::tag.tag` move to the plugin's UIDs, only where the legacy UID is the whole UID (`api::tag.tag-group` is another type's and stays); a second boot changes nothing.
- **A host with its own `/api/categories`** keeps its route: host routes register first, so the plugin's answers nothing on that path.
- **The plugin owns the tables `categories` and `tags`.** A host type on either (a `collectionName` of `categories` or `tags`, which is the default of a type named `category` or `tag`) stops booting with `DB table "categories" already exists`, and changing its `collectionName` alone loses its data: Strapi moves no rows, so the plugin's type takes the old table and drops the columns it does not know. Back up and move the tables first ([below](#a-host-type-on-categories-or-tags)), or remove the type if it is `micelio-cms`' own. A host type that keeps the UID `api::category.category` or `api::tag.tag` keeps its grants and layouts: the migration leaves a UID that is still registered alone.
- **The inverse `articles` relation** is not in the plugin: a plugin's type cannot target a type of the host. The distribution adds it to both types through `src/extensions/micelio/strapi-server` (ADR-0017, amendment of 2026-10-26, D5).

### A host type on `categories` or `tags`

Before the first boot with this version, with the host stopped:

1. Back up the database (`pg_dump -Fc`).
2. Change the type's `collectionName` to a free name, here `host_categories`.
3. Rename every table the type owns, and the indexes, constraints and sequences that carry the old name, in one transaction. A table renamed alone fails the boot with `relation "categories_documents_idx" already exists`. Strapi 5 gives a collection type its own table (`<collectionName>`) and these, all starting with `<collectionName>_` (`@strapi/database` 5.58, `utils/identifiers/index.js` and `metadata/relations.js`; `@strapi/core` `utils/transform-content-types-to-models.js`):
   - `<collectionName>_<attribute>_lnk`, one per relation the type owns.
   - `<collectionName>_cmps`, for all its components and dynamic zones.
   - `<collectionName>_<attribute>_mph`, one per `morphToMany` attribute. A `morphToOne` attribute is two columns of the type's own table.
   - Media is a row of `files_related_mph` keyed by the type's UID, which does not change. A localised type has no table of its own: its locales are rows of the same table.

   The SQL renames every table that starts with `categories_`, so it covers all of them. Before the first boot with this version they are all the host's; check with `\dt categories*` that none belongs to another type. Set `old_name` and `new_name` at the top of the script.

```sql
BEGIN;
DO $$
DECLARE
  old_name constant text := 'categories';
  new_name constant text := 'host_categories';
  schema_oid constant oid := (SELECT oid FROM pg_namespace WHERE nspname = current_schema());
  r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c
           WHERE c.relkind = 'r' AND c.relnamespace = schema_oid
             AND (c.relname = old_name OR left(c.relname, length(old_name) + 1) = old_name || '_') LOOP
    EXECUTE format('ALTER TABLE %I RENAME TO %I', r.relname, new_name || substr(r.relname, length(old_name) + 1));
  END LOOP;
  FOR r IN SELECT t.relname AS tbl, k.conname FROM pg_constraint k JOIN pg_class t ON t.oid = k.conrelid
           WHERE t.relnamespace = schema_oid
             AND (t.relname = new_name OR left(t.relname, length(new_name) + 1) = new_name || '_')
             AND left(k.conname, length(old_name)) = old_name LOOP
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, new_name || substr(r.conname, length(old_name) + 1));
  END LOOP;
  FOR r IN SELECT indexname FROM pg_indexes
           WHERE schemaname = current_schema()
             AND (tablename = new_name OR left(tablename, length(new_name) + 1) = new_name || '_')
             AND left(indexname, length(old_name)) = old_name LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, new_name || substr(r.indexname, length(old_name) + 1));
  END LOOP;
  FOR r IN SELECT s.relname FROM pg_class s
             JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
             JOIN pg_class t ON t.oid = d.refobjid
           WHERE s.relkind = 'S' AND t.relnamespace = schema_oid
             AND (t.relname = new_name OR left(t.relname, length(new_name) + 1) = new_name || '_')
             AND left(s.relname, length(old_name)) = old_name LOOP
    EXECUTE format('ALTER SEQUENCE %I RENAME TO %I', r.relname, new_name || substr(r.relname, length(old_name) + 1));
  END LOOP;
END $$;
COMMIT;
```

4. After the boot, `\dt host_categories*` lists the type's tables with their rows, and the plugin's `categories` and `categories_site_lnk` are new and empty.

Repeat with `tags` and `host_tags` for a type on `tags`. The SQL is for PostgreSQL in the schema the connection uses (`current_schema()`); the steps were run on 18, with a link, a component, a dynamic zone, a media and a `morphToMany` attribute. MySQL and SQLite hosts are unproven: they move the same tables with their own tools, and on SQLite, where index names are global, drop the indexes that carry the old name and let Strapi recreate them. Strapi shortens a name over 55 characters with a hash, so check that a name longer than that, with `host_` added, is the one Strapi expects.

## Errors

A `site` that names no site answers `404` with `application/problem+json` (RFC 9457):

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "There is no site \"missing\".",
  "code": "unknownSite"
}
```

A client branches on `code`, never on `detail`. The same code answers when the request names no site and no site is the default.

## Sites

- `hosts` is a list of host names, stored in lower case: no scheme, port or path. Two sites cannot share a host name.
- Exactly one site is the default. Making a site the default takes it from the previous one; the default site can be neither unset nor deleted, so make another site the default first.
- A fresh instance starts with one neutral site, `default`.

## Editorial transitions

An admin API route, for the admin panel and admin users; it is not part of the content API.

| Method | Path                   | Answers                                                   |
| ------ | ---------------------- | --------------------------------------------------------- |
| `POST` | `/micelio/transitions` | `{ "data": { uid, documentId, locale, from, to, site } }` |

The body names the entry and where it goes: `{ "uid": "api::article.article", "documentId": "…", "to": "in_review" }`, with an optional `locale` (publishing is per locale, and so is the editorial state: each locale of an entry moves on its own) and, to schedule, `publishAt` as an ISO 8601 date in the future.

Entries of a type made with `withEditorial` move through these transitions (ADR-0017, section 5), and no other route publishes or unpublishes them, the Content Manager included:

| Transition              | Who may perform it by default               | Strapi permission it also needs |
| ----------------------- | ------------------------------------------- | ------------------------------- |
| `draft → in_review`     | Author, Editor, Super Admin                 | update                          |
| `in_review → draft`     | Author, Editor, Super Admin                 | update                          |
| `in_review → published` | Editor, Super Admin                         | publish                         |
| `draft → scheduled`     | Editor, Super Admin                         | update                          |
| `scheduled → draft`     | Editor, Super Admin                         | update                          |
| `scheduled → published` | The plugin's scheduler only, at `publishAt` |                                 |
| `published → draft`     | Editor, Super Admin                         | publish                         |
| `published → published` | Editor, Super Admin                         | publish                         |

A site replaces the default for a transition with its `editorialPolicy`, a map from `from->to` to role codes: `{ "draft->in_review": ["strapi-editor"] }`. The Strapi permission is checked as the Content Manager checks it, so an Author moves only their own entries.

`in_review → published`, `scheduled → published` and `published → published` are the transitions that publish the entry in Strapi, and `published → draft` the one that unpublishes it.

`published → published` is the republish: an edit of a live entry sits in Strapi's draft while the published version stays live, and the republish puts it live with one `publish` of the document service, never an unpublish first, so the content API answers the previous version until the republish and the new one after it, with no moment in between when it answers none. `state` stays `published`, `publishedAt` becomes the time of the republish, `publishedBy` becomes the person who republished and `reviewedBy` is not touched: a republish skips review, so whoever may republish decides alone. Publishing an already published entry in the Content Manager stays refused. It fires `afterTransition` with `published` as `from` and `to`, and `afterPublish`.

The scheduler, a cron job of the plugin, performs `scheduled → published` for every entry whose `publishAt` has passed: every minute by default (`scheduledPublishRule`, README; `false` turns it off), with an empty `publishedBy`. An entry it cannot publish is logged and stays scheduled for the next run. Leaving `in_review` records the user in `reviewedBy`; publishing records them in `publishedBy`.

Every transition, the scheduler's included, runs the hooks of [docs/hooks.md](hooks.md): other plugins react to it there, and a `beforeTransition` handler may refuse it.

### Errors

Every refusal answers `application/problem+json`:

| Status | `code`                         | When                                                  |
| ------ | ------------------------------ | ----------------------------------------------------- |
| 400    | `editorialRequestInvalid`      | The body lacks `uid`, `documentId` or a valid `to`    |
| 400    | `editorialTypeInvalid`         | The type was not made with `withEditorial`            |
| 400    | `editorialPublishAtInvalid`    | `scheduled` without a `publishAt` in the future       |
| 403    | `editorialTransitionForbidden` | The site's policy or the user's permissions refuse it |
| 404    | `editorialEntryNotFound`       | No such entry in that locale                          |
| 409    | `editorialTransitionInvalid`   | The state machine has no such transition              |
| 409    | `editorialTransitionRefused`   | A `beforeTransition` handler of a plugin refused it   |

## Block catalogue

An admin API route, for the admin panel and its builder; any admin user may read it.

| Method | Path              | Answers                                                                 |
| ------ | ----------------- | ----------------------------------------------------------------------- |
| `GET`  | `/micelio/blocks` | `{ "data": [{ id, group, component, schema, options, cost, static }] }` |

One entry per block of the catalogue, in its order. `schema` is the block's JSON Schema, the one under `$defs` in `contract/blocks.schema.json`; [`docs/blocks.md`](blocks.md) describes the fields and the reference of every block.

## Status

Admin API routes, behind the status page of the admin ([docs/operate/status-page.md](operate/status-page.md)). It needs the admin permission `plugin::micelio.status.read` (Settings → Roles → Plugins → Micelio); the super admin has it.

| Method | Path                         | Answers                                                                |
| ------ | ---------------------------- | ---------------------------------------------------------------------- |
| `GET`  | `/micelio/status`            | `{ "data": { plugin, sites, frontends, hostCheck, blocks, plugins } }` |
| `POST` | `/micelio/status/host-check` | `{ "data": HostCheckReport }`                                          |

- `plugin`: `version` (the package's) and `coreLine` (`micelio` in its `package.json`).
- `sites`: `documentId`, `name` (in the default locale when the site has it), `slug`, `hosts`, `isDefault` and `origin`, the origin of the site's `url` or `null`. The default site comes first.
- `frontends`: one per distinct `origin`, with the `sites` (slugs) behind it, `health` and `version`. The route asks each one for `GET <origin>/_health` on every call, at most two seconds each: `reachable` with the `version` of its answer when it gave one, `unavailable` when it answered outside `2xx` or not at all. `unavailable` is not an error: a frontend may not serve the endpoint yet.
- `hostCheck`: the latest run of the host check (`HostCheckReport`, [docs/operate/host-check.md](operate/host-check.md)), `null` if it has not run since the boot. `GET` does not run it again.
- `blocks`: `count`, the number of blocks in the catalogue.
- `plugins`: by plugin `id`, the latest checks of each sibling plugin that registered some (`registerStatusChecks`, [extension points](plugins/extension-points.md)) and whose `permission` the caller has: `label`, `ranAt` (ISO 8601, `null` until the checks first run) and `checks`, each a `Check` with the `site` (`documentId`) it ran for. `GET` never runs them.

`POST /micelio/status/host-check` runs the host check again and the checks of sibling plugins for every site, keeps their results as the latest (what `GET` answers afterwards) and answers the host check's report. The checks also run every day (`statusRefreshRule`, README). It takes no body. It runs the check as `micelio doctor` reports it: a failed required check is in the report, and nothing is logged or stopped. A request made while a run is in progress gets that run's report instead of starting another.

The shape is `StatusReport` in `server/src/types/status.ts`. On both routes, a role without the permission gets `403` with the `code` `statusForbidden`, as `application/problem+json`; a request without an admin token gets Strapi's `401`.

## Preview

Three routes carry a draft from the admin to the frontend's iframe without a long-lived credential (ADR-0019, section 3). [docs/operate/preview.md](operate/preview.md) sets it up and says what the frontend does with them. Every answer to a credential is `private, no-store`, and tokens and grants appear in no log, problem detail or message.

| Method | Path                            | Who calls it                                   | Answers                                                                                      |
| ------ | ------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `POST` | `/micelio/preview/token`        | The admin page, with the admin's token         | `{ "data": { "url", "expiresAt" } }`                                                         |
| `POST` | `/api/micelio/preview/exchange` | The frontend, with its API token               | `{ "data": { "grant", "expiresAt", "adminOrigin", "contentType", "documentId", "locale" } }` |
| `GET`  | `/api/micelio/preview/draft`    | The frontend, with its API token and the grant | `{ "data": <the draft>, "meta": { "actor": "admin" \| "system" } }`                          |

### Preview token

`POST /micelio/preview/token` is an admin route. It needs the admin permission `plugin::micelio.preview` (Settings → Roles → Plugins → Micelio; the super admin has it) and the permission to read the entry. The body is `{ "uid", "documentId", "locale" }`: `uid` is a content type made with `withSiteScope`, and `locale` is a string or `null`, or omitted for the default one.

`url` is `<site.url>/_preview?token=<token>` and `expiresAt` an ISO 8601 date 60 seconds ahead. The token is random and opaque, used once, and bound to the calling admin user, the site, the content type, the `documentId`, the locale of the draft found (the default locale when the request names none; `null` for a type that is not localised) and the admin's origin (the `Origin` header of the request). Only its hash is stored. A user may ask 20 times a minute.

### Grant exchange

`POST /api/micelio/preview/exchange?site=<slug>` takes `{ "token" }` and the frontend's API token. The token must be a full-access one or a custom one that allows `plugin::micelio.preview.exchange`: a read-only token is refused by Strapi with `403`. The `site` parameter works as for every content API route ([Which site a request is for](#which-site-a-request-is-for)).

The plugin marks the token used, checks again that the admin user may read the draft and answers a grant: opaque, valid for 15 minutes, bound like the token and stored hashed. `adminOrigin` is the admin origin bound in the grant: the frontend compares it with its own configured admin origin and refuses the grant on a mismatch (ADR-0019, section 5). An API token may exchange 60 times a minute.

### Draft by grant

`GET /api/micelio/preview/draft?site=<slug>&documentId=<id>[&locale=<code>]` takes the frontend's API token (it must allow `plugin::micelio.preview.draft`) and the grant in the header `X-Micelio-Preview-Grant`. It serves the **draft** of the one document the grant names, in Strapi's content API format; `documentId` and `locale` must be the grant's. The only other parameter is `populate`: the route serves one document and nothing a query could use to learn about another, so `fields`, `filters`, `sort`, `pagination` and any other key answer `400` with the code `previewRequestInvalid`, and so does an invalid `populate`. The `populate`:

- may name the attributes of the draft's type and, inside its components and dynamic zones, their attributes, at any depth; `*` is the first level, and cannot be mixed with names. A `populate` of a name that is not an attribute, of a private attribute, of an unknown dynamic zone component, or of a relation to an admin user or to no single type (a polymorphic relation) is refused.
- goes one level through a relation: the `fields` of the related entry and, as its `populate`, the related entry's media attributes with `fields` only (`author: { fields: ['name'], populate: { avatar: { fields: ['url'] } } }`). A relation, a component or a dynamic zone under a relation, `*` under it, and `filters`, `sort`, `pagination`, `count` or `on` are refused.
- goes no further than `fields` through a media attribute, so the file's `related` entries are never reached.
- returns a related entry as its **published** version, with the `fields` asked for, never its draft: the grant serves the draft of the one document it names. A related entry that was never published is left out.
- returns only entries of the grant's site: an entry of a site-scoped type that belongs to another site is left out.
- is still within the API token's permissions: a populated relation to a type the token may not `find` is left out, as on any content API route. The token's permissions on other routes are not touched.

The frontend's `populate` of an article (cover, author and its avatar, category, tags, blocks, references, localizations) and of a page is served whole.

`meta.actor` says whose grant it was: `admin` for the grant of an admin user (above), `system` for a **system grant**, the credential the plugin mints for itself to measure one draft at publish (ADR-0019, amendment of 2026-10-25). No route mints a system grant, and no response carries one. It is bound to the site, content type, `documentId`, locale and the `updatedAt` of the draft at minting, lives 60 seconds and is used once: the first request that finds it unused claims it, and a second gets `previewRefused`, as does one that finds the draft saved since (another `updatedAt`). It has no admin user, so nothing is checked about one, logging out revokes nothing of it, and the exchange refuses it as a token. A frontend accepts `system` only on the route that measures a draft and refuses it everywhere else.

Each use of an `admin` grant checks again that the admin user is active and may read the draft. Logging out of the admin revokes every token and grant of that user at once; losing the right to read a draft revokes the grants of that user and draft at the next exchange or draft request, and giving the right back does not bring them back.

### Errors

Every refusal is `application/problem+json`:

| Status | `code`                  | When                                                                                                                                                                        |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `previewRequestInvalid` | The body, the grant header or `documentId` is missing or malformed; on the draft route, a query the allowlist above refuses                                                 |
| 400    | `previewTypeInvalid`    | The type does not belong to a site                                                                                                                                          |
| 403    | `previewForbidden`      | The role lacks the preview permission, or may not read the entry                                                                                                            |
| 404    | `previewEntryNotFound`  | The token route found no such entry                                                                                                                                         |
| 404    | `previewRefused`        | A token or grant that is unknown, used, expired, revoked, or of another site, document or locale; a system grant that is spent or whose draft was saved since it was minted |
| 409    | `previewUnavailable`    | The entry's site has no `url`, so there is no frontend to preview on                                                                                                        |
| 429    | `previewRateLimited`    | Over the rate limit; `Retry-After` says when to try again                                                                                                                   |

`previewRefused` is one answer for every reason, so it names nothing. A request without an admin token (token route) or without a valid API token (the other two) gets Strapi's `401`.

The rate limits are counted by each process of the host separately, so with several processes the limit is multiplied.

The messages between the admin and the frame are in `contract/preview.ts`; its JSON Schema, `contract/preview.schema.json`, is published as `@micelio/strapi-plugin-core/preview.schema.json`. Phase 1 has `ready` (frame → admin: the `v` values the frame speaks, `documentId`, `locale`, `version`) and `load-draft` (admin → frame: `documentId`, `locale`), in the envelope `{ "v": 1, "type", "payload" }`. A receiver drops any other `v`, any `type` it does not know, and any payload that fails the schema (ADR-0019, section 4).

## Extension points

Admin API routes behind the [extension points](plugins/extension-points.md); both need an admin token.

| Method | Path                   | Answers                                                                        |
| ------ | ---------------------- | ------------------------------------------------------------------------------ |
| `GET`  | `/micelio/admin-pages` | `{ "data": [{ id, group, label, to }] }`                                       |
| `GET`  | `/micelio/sites`       | `{ "data": [{ documentId, name, slug, hosts, isDefault, origin, sections }] }` |

### Sites in the admin

`GET /micelio/sites` needs the Content Manager permission to read the `Site` type; without it the answer is `403` with the `code` `sitesForbidden`. Each site has `sections`, an object keyed by the `id` of every site section whose `permission` the caller has, holding that site's instance of the section's component (`null` if it has none); a section the caller may not read is not a key. The default site comes first, then by slug.

### Pages

`GET /micelio/admin-pages` lists the pages sibling plugins registered whose `permission` the caller has, in registration order. The `to` is relative to `/plugins/micelio/`.
