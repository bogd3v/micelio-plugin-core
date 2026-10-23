# Content API

How the plugin's content API routes behave. Routes keep Strapi's content API format (section 4 of the engineering standard); only the errors the plugin adds are problem details. Every route needs an API token: the plugin grants nothing to the public role.

## Routes

| Method | Path                     | Answers                                             |
| ------ | ------------------------ | --------------------------------------------------- |
| `GET`  | `/api/micelio/sites`     | The sites, in Strapi's list format (`data`, `meta`) |
| `GET`  | `/api/micelio/sites/:id` | One site by `documentId`                            |

The prefix `/micelio` is set explicitly, so a host's own `/api/sites` does not collide with it.

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

The body names the entry and where it goes: `{ "uid": "api::article.article", "documentId": "…", "to": "in_review" }`, with an optional `locale` (publishing is per locale) and, to schedule, `publishAt` as an ISO 8601 date in the future.

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

| Method | Path                         | Answers                                                       |
| ------ | ---------------------------- | ------------------------------------------------------------- |
| `GET`  | `/micelio/status`            | `{ "data": { plugin, sites, frontends, hostCheck, blocks } }` |
| `POST` | `/micelio/status/host-check` | `{ "data": HostCheckReport }`                                 |

- `plugin`: `version` (the package's) and `coreLine` (`micelio` in its `package.json`).
- `sites`: `documentId`, `name` (in the default locale when the site has it), `slug`, `hosts`, `isDefault` and `origin`, the origin of the site's `url` or `null`. The default site comes first.
- `frontends`: one per distinct `origin`, with the `sites` (slugs) behind it, `health` and `version`. The route asks each one for `GET <origin>/_health` on every call, at most two seconds each: `reachable` with the `version` of its answer when it gave one, `unavailable` when it answered outside `2xx` or not at all. `unavailable` is not an error: a frontend may not serve the endpoint yet.
- `hostCheck`: the latest run of the host check (`HostCheckReport`, [docs/operate/host-check.md](operate/host-check.md)), `null` if it has not run since the boot. `GET` does not run it again.
- `blocks`: `count`, the number of blocks in the catalogue.

`POST /micelio/status/host-check` runs the host check again, keeps its report as the latest (what `GET` answers afterwards) and answers it. It takes no body. It runs the check as `micelio doctor` reports it: a failed required check is in the report, and nothing is logged or stopped. A request made while a run is in progress gets that run's report instead of starting another.

The shape is `StatusReport` in `server/src/types/status.ts`. On both routes, a role without the permission gets `403` with the `code` `statusForbidden`, as `application/problem+json`; a request without an admin token gets Strapi's `401`.
