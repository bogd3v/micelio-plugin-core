# Preview

The preview shows a draft on the frontend, which serves only published content to the public. The admin page puts the frontend's draft route in an iframe; this page is for the operator who sets it up and for whoever writes the frontend's side. The decision and its reasons are [ADR-0019](https://github.com/bogd3v/micelio/blob/main/docs/adr/0019-visual-editing-protocol.md), section 3; the routes are in [api.md](../api.md).

No shared secret is involved: the plugin needs no new variable, and the frontend needs its API token, with the permissions below, and the origin of the admin, set in its configuration.

## Set it up

1. Give each site a `url`, the frontend's origin. A site without one has no preview: the token route answers `previewUnavailable`.
2. In Settings → Roles → Plugins → Micelio, give the roles that preview the permission **Preview drafts on the frontend**. The super admin has it. The token route also needs the permission to read the document, so a role previews only what it may read.
3. Give the frontend an API token that may call the exchange and the draft route: a full-access token, or a custom one with `plugin::micelio.preview.exchange` and `plugin::micelio.preview.draft` (Settings → API Tokens → Plugin: Micelio). A read-only token cannot exchange: Strapi answers `403`. The permissions of the token the distribution creates for the frontend are `micelio-cms`'s to set.
4. Add the sites' origins to `frame-src` in the admin's `strapi::security` config; the host check (`preview-frame-src`, [host-check.md](host-check.md)) says when they are missing.

## The flow

1. The admin page asks the plugin for a **preview token**: `POST /micelio/preview/token` with `{ uid, documentId, locale }`. It answers `url`, `<site.url>/_preview?token=<token>`, and the page sets it as the `src` of the iframe.
2. The frontend's `/_preview` route takes the token from the URL and sends it to `POST /api/micelio/preview/exchange?site=<slug>` with its API token. The answer is a **grant** and the `adminOrigin` bound in it, which the frontend compares with its own configured admin origin, refusing the grant on a mismatch (see below).
3. The frontend keeps the grant in a `HttpOnly` cookie and answers `303` to the draft route without the token, so the token never stays in the frame's history or in a `Referer`.
4. The draft route fetches the draft from `GET /api/micelio/preview/draft?site=<slug>&documentId=<id>` with its API token and the grant in the header `X-Micelio-Preview-Grant`. It serves only the document the grant names.
5. When the grant expires, the admin page asks for a new token and reloads the iframe.

| Credential   | Valid for | Use                      | Bound to                                                                                               |
| ------------ | --------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| Token        | 60 s      | Once                     | The admin user, site, content type, `documentId`, locale and the admin's origin                        |
| Grant        | 15 min    | Until it expires or ends | The same as the token it came from                                                                     |
| System grant | 60 s      | Once                     | The site, content type, `documentId`, locale and the version (`updatedAt`) of the draft; no admin user |

All three are random, opaque values (not JWTs), and the CMS stores only their hash. A used, expired, unknown, revoked or wrong-site token gets the same refusal, `404` `previewRefused`, which names nothing; do the same for the draft route and answer it as for a draft that does not exist, with `private, no-store`.

## The system grant

The plugin measures a page at publish by calling the frontend's weight report from the CMS server, where there is no browser and may be no admin user (ADR-0019, amendment of 2026-10-25). For that it mints a **system grant** for itself: `issueSystemGrant` of the `preview` service, called by plugin code in the publish path. No route mints one, and no response carries one; the plugin sends it in `X-Micelio-Preview-Grant` to the weight route of the site's `url` and nowhere else.

- It names one draft and the `updatedAt` it had when the grant was minted. The frontend presents it to `GET /api/micelio/preview/draft` as it presents any grant and gets the draft with `meta.actor` `system`. If the draft was saved after the grant was minted, the answer is `previewRefused`.
- It lives 60 seconds and works once. Nothing else ends it earlier: no admin user is involved, so logging out revokes nothing of it.
- It adds no variable and no shared secret, and gives no one a right: it lets the plugin read the one draft it names. Whether someone may publish is the editorial policy's decision.
- **The frontend's API token needs `plugin::micelio.preview.draft`** even when the preview is off, because the weight report is read through it (step 3 above). A full-access token has it. A token made by hand under Settings → API Tokens adds it; the token the distribution creates for the frontend gets it from `micelio-cms`.

## What ends a grant

- Logging out of the admin revokes every token and grant of the user, and no system grant.
- Each exchange and each draft request checks again that the admin user is active and may read the draft. When they may not, every grant of that user and draft is revoked, and giving the permission back does not bring them back.

## What the frontend needs

- Its **API token** and the permissions of step 3.
- The **admin origin**, from its configuration (an optional variable of the frontend; without it the preview is off). It is the `frame-ancestors` of the draft route and the origin its messages are checked against ([ADR-0019](https://github.com/bogd3v/micelio/blob/main/docs/adr/0019-visual-editing-protocol.md), sections 4 and 5). It must match the `adminOrigin` bound in the grant: the frontend refuses a grant whose `adminOrigin` differs, and never frames itself for the origin an answer names, because that origin is the `Origin` header of whoever asked for the token. The grant cookie, `frame-ancestors` and the `/_preview` route are built in bogd3v/micelio#729.
- The message schema, `@micelio/strapi-plugin-core/preview.schema.json`, to validate `ready` and `load-draft`.

Never put a token or a grant in a log, a cache key, an error or a `Referer`.

## Limits

The token route allows 20 requests a minute for each admin user and the exchange 60 for each API token, answering `429` with `Retry-After`. The counts live in the memory of each process, so a host with several processes allows the limit for each of them. Expired credentials are deleted from the store an hour after they expire, whenever a token is requested.
