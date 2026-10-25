# Content API

How the plugin's content API routes behave. Routes keep Strapi's content API format (section 4 of the engineering standard); only the errors the plugin adds are problem details. Every route needs an API token: the plugin grants nothing to the public role.

## Routes

| Method | Path                     | Answers                                             |
| ------ | ------------------------ | --------------------------------------------------- |
| `GET`  | `/api/micelio/sites`     | The sites, in Strapi's list format (`data`, `meta`) |
| `GET`  | `/api/micelio/sites/:id` | One site by `documentId`                            |

The prefix `/micelio` is set explicitly, so a host's own `/api/sites` does not collide with it. The preview routes ([Preview](#preview)) are content API routes too.

## Which site a request is for

Every content type of a Micelio plugin belongs to one site (ADR-0017, section 4). On the routes of such a type, the site of a request is, in this order:

1. The one whose `slug` the `site` query parameter names: `/api/notes?site=example`.
2. The one whose `hosts` list the host name the request was made to (`X-Forwarded-Host` counts only when the host sets `server.proxy`).
3. The default site (`isDefault`), which keeps a frontend that names no site working unchanged.

Reads answer only that site's entries; reading, changing or deleting another site's entry by its id answers `404`, as if it did not exist; and an entry created through the content API belongs to that site.

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

A site replaces the default for a transition with its `editorialPolicy`, a map from `from->to` to role codes: `{ "draft->in_review": ["strapi-editor"] }`. The Strapi permission is checked as the Content Manager checks it, so an Author moves only their own entries.

`in_review → published` and `scheduled → published` are the transitions that publish the entry in Strapi, and `published → draft` the one that unpublishes it. The scheduler, a cron job of the plugin, performs `scheduled → published` for every entry whose `publishAt` has passed: every minute by default (`scheduledPublishRule`, README; `false` turns it off), with an empty `publishedBy`. An entry it cannot publish is logged and stays scheduled for the next run. Leaving `in_review` records the user in `reviewedBy`; publishing records them in `publishedBy`.

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
| `GET`  | `/api/micelio/preview/draft`    | The frontend, with its API token and the grant | `{ "data": <the draft>, "meta": {} }`                                                        |

### Preview token

`POST /micelio/preview/token` is an admin route. It needs the admin permission `plugin::micelio.preview` (Settings → Roles → Plugins → Micelio; the super admin has it) and the permission to read the entry. The body is `{ "uid", "documentId", "locale" }`: `uid` is a content type made with `withSiteScope`, and `locale` is a string or `null`, or omitted for the default one.

`url` is `<site.url>/_preview?token=<token>` and `expiresAt` an ISO 8601 date 60 seconds ahead. The token is random and opaque, used once, and bound to the calling admin user, the site, the content type, the `documentId`, the locale of the draft found (the default locale when the request names none; `null` for a type that is not localised) and the admin's origin (the `Origin` header of the request). Only its hash is stored. A user may ask 20 times a minute.

### Grant exchange

`POST /api/micelio/preview/exchange?site=<slug>` takes `{ "token" }` and the frontend's API token. The token must be a full-access one or a custom one that allows `plugin::micelio.preview.exchange`: a read-only token is refused by Strapi with `403`. The `site` parameter works as for every content API route ([Which site a request is for](#which-site-a-request-is-for)).

The plugin marks the token used, checks again that the admin user may read the draft and answers a grant: opaque, valid for 15 minutes, bound like the token and stored hashed. `adminOrigin` is the admin origin bound in the grant: the frontend compares it with its own configured admin origin and refuses the grant on a mismatch (ADR-0019, section 5). An API token may exchange 60 times a minute.

### Draft by grant

`GET /api/micelio/preview/draft?site=<slug>&documentId=<id>[&locale=<code>]` takes the frontend's API token (it must allow `plugin::micelio.preview.draft`) and the grant in the header `X-Micelio-Preview-Grant`. It serves the **draft** of the one document the grant names, in Strapi's content API format; `documentId` and `locale` must be the grant's. Other query parameters (`populate`, `fields`) work as on any content API route, within the API token's permissions.

Each use checks again that the admin user is active and may read the draft. Logging out of the admin revokes every token and grant of that user at once; losing the right to read a draft revokes the grants of that user and draft at the next exchange or draft request, and giving the right back does not bring them back.

### Errors

Every refusal is `application/problem+json`:

| Status | `code`                  | When                                                                                             |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------------ |
| 400    | `previewRequestInvalid` | The body, the grant header or `documentId` is missing or malformed                               |
| 400    | `previewTypeInvalid`    | The type does not belong to a site                                                               |
| 403    | `previewForbidden`      | The role lacks the preview permission, or may not read the entry                                 |
| 404    | `previewEntryNotFound`  | The token route found no such entry                                                              |
| 404    | `previewRefused`        | A token or grant that is unknown, used, expired, revoked, or of another site, document or locale |
| 409    | `previewUnavailable`    | The entry's site has no `url`, so there is no frontend to preview on                             |
| 429    | `previewRateLimited`    | Over the rate limit; `Retry-After` says when to try again                                        |

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
