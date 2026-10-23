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
