# Page budgets

A page of a type that `budgets.contentTypes` lists (by default the types the frontend previews) is measured when it is published, and publishing it is refused when its blocks weigh more than its budget. The editor sees the same measurement while writing, in the cost meter of the preview page and in the cost line of the edit view. The measurement is the frontend's: the plugin has it render the draft and reads what it says, and never estimates. The decision is [ADR-0019](https://github.com/bogd3v/micelio/blob/main/docs/adr/0019-visual-editing-protocol.md), amendment of 2026-10-25; the weight report is `docs/performance.md`, "Weight of a draft", in `micelio`; the error is in [api.md](../api.md).

## What is measured

A type is measured when `budgets.contentTypes` lists it and it belongs to a site (`withSiteScope`), has the editorial workflow (`withEditorial`) and has a dynamic zone, which is where the blocks live. **The list is `api::page.page` and `api::article.article` unless you set it**: those are the types the frontend previews, and its weight route answers `404` for any other, so it cannot measure them. A UID in the list that matches no type, or a type that is not site-scoped, editorial and with a dynamic zone, is ignored without a warning, so check its spelling: a typo in a list that replaces the default leaves the real type unmeasured. Every other type publishes as before, with no measurement, no grant and no request to the frontend, whatever its dynamic zone. A type you list that the frontend cannot measure is refused on every publish with `previewUnavailable`, so list a type only when the frontend previews it (a sibling plugin's type is not measured until it is listed and the frontend learns to render it).

Publishing is moving to `published` with the `transitions` service: `in_review → published`, `scheduled → published` and the republish `published → published`. Every path to them runs the measurement, because it is in the transition: the admin route, the service other plugins call and the scheduler. Strapi's own publish button and the Document Service's `publish` are refused for these types with or without a budget. The one deliberate exception is the import of a site archive (`micelio import`, [export.md](export.md)): it restores what was published and measures nothing, and only the operator's command line runs it.

The plugin asks the weight route of the site's `url` (`GET /api/preview/<uid>/<documentId>/weight?mode=dynamic&locale=…`) with a **system grant** ([preview.md](preview.md)): minted for that draft, its `updatedAt` and the locale, valid 60 seconds, used once, sent in `X-Micelio-Preview-Grant` to that route and nowhere else, and the request follows no redirect. The report is for the dynamic mode, in kB (1024 bytes) as the server sends them: the page's `totalKb` (HTML, CSS, scripts, fonts and the images loaded without scrolling) and the share of each block (what the page weighs more with it than without it). **The budget is measured against the sum of the blocks' shares** (`blocksKb`): the framework's script, styles and fonts (`frameworkKb`, `totalKb` minus `blocksKb`, about 270 kB on the frontend of `main`) come with every page and are not the editor's to change, so they are shown apart and never counted. The script an island loads only once it is used is reported apart too, as **on demand**, and never counts either.

## The budget

| Page type   | Budget |
| ----------- | ------ |
| `landing`   | 60 kB  |
| `standard`  | 120 kB |
| `long-read` | 160 kB |

A page is `standard` unless it has a string attribute `pageType` that the budgets list. (The page type becomes an attribute of its own with the page settings, bogd3v/micelio-plugin-core#52.) Budgets are set in configuration and nowhere else; there is no setting in the admin. In `config/plugins`:

```js
module.exports = {
  micelio: {
    enabled: true,
    config: {
      budgets: {
        // The types measured at publish; this list replaces the default whole.
        contentTypes: ['api::page.page', 'api::article.article'],
        // A key replaces the default of that page type; the others keep theirs.
        pageTypes: { 'long-read': 200 },
        // One site's own budgets, by the site's slug.
        sites: { blog: { standard: 90, poster: 30 } },
      },
    },
  },
}
```

A site's budget for a page type wins over `pageTypes`, and a page type nobody configured has the `standard` budget. A value that is not a number above 0, or a `contentTypes` that is not an array of content type UIDs, stops the boot with a message that names `budgets`. A page on its budget publishes: only a weight above it is refused.

## When a publish is refused

| Answer               | When                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pageOverBudget`     | The blocks of the page weigh more than its budget. The answer lists the blocks, heaviest first, and by how much the page is over |
| `previewUnavailable` | The page could not be measured. It is never published without the measurement                                                    |

`previewUnavailable` is the answer when the site has no `url`; the frontend cannot be reached or takes more than 30 seconds; it redirects; it answers anything but a readable report; or the frontend keeps answering `429` (the plugin asks again up to three times, waiting what `Retry-After` says up to 5 seconds and minting a new grant each time); or the draft was saved after it was measured, checked right before the publish. The entry keeps its state. The editor reads one fixed sentence; the cause is logged on the server (`micelio: could not measure …`), never with a grant, since it can name hosts of the CMS's network.

A publish can wait for the frontend as long as 4 requests of 30 seconds and 3 waits of 5 seconds, so up to about two minutes and a quarter, before it is refused; a proxy in front of the admin that cuts a request earlier shows the editor a failed request, and the publish still ends as it ends (published or refused), so look at the entry before trying again. The draft is checked again right before it is published, but a save that lands between that check and the publish itself (a window of milliseconds) is published without having been measured; the next publish measures it.

A `scheduled` page that cannot be measured, or is over its budget when its time comes, stays `scheduled`: the scheduler logs it and tries again every minute, each try a grant and a render of the draft, until the page is edited or moved to another state.

## For the operator

- **The frontend's API token needs `plugin::micelio.preview.draft`**, even when the preview is off, because the frontend reads the draft through it to render the report. A full-access token has it, and so does the token `micelio-cms` creates for the frontend. A token made by hand under Settings → API Tokens → Plugin: Micelio must add it, or **every publish of a measured page is refused** with `previewUnavailable`.
- The CMS server calls the site's `url`, so that address must be reachable from the CMS, not only from a browser. Behind a proxy that path is kept (`https://example.com/site`).
- The frontend must have the weight route (bogd3v/micelio#730). Without it a publish of a measured type is refused.
- A site-scoped, editorial type of your own or of a plugin, with a dynamic zone, that is not in `contentTypes` publishes as before. Do not add it until the frontend previews it.
- A publish waits for the measurement, a render of the draft (3 seconds for a ten-block page is the frontend's target). The frontend keeps a report for five minutes for each version of a draft.

## The cost meter

The preview page shows the meter under the entry: the blocks' weight against the budget ("42 kB of 60 kB"), the page type, a bar, the script loaded only on demand apart, the weight of each block on expand, when it was measured and **Measure again**. The meter shows the blocks' weight against the budget, with the framework's share and the on-demand weight as separate lines. The bar and its words change at 90 % of the budget ("Close to the budget") and past 100 % ("Over the budget by 10 kB. This page cannot be published."), and not along the way; a page exactly on its budget is "close", since it publishes. The meter measures again after each save. The meter does not go through the plugin's system grant, which only the publish path mints (the plugin's route would otherwise use up the document's measurements at publish, [preview.md](preview.md)). The page reads the weight report from the frontend with the **editor's own preview grant**, the one the frame has already exchanged and keeps in its `HttpOnly` cookie, so the browser itself asks the weight route of the site's `url` once the frame has loaded; the admin's own token is never sent there. The page then sends the report to `POST /micelio/budget/measure`, which places it against the budget of the saved draft, so it needs the permission to preview drafts and the permission to read the entry. A type that is not measured shows no meter.

For that request to work the frontend's weight route must allow the admin's origin with credentials (`Access-Control-Allow-Origin: <admin origin>`, `Access-Control-Allow-Credentials: true`; the frontend does since bogd3v/micelio#766), and **the admin's Content Security Policy must let the browser connect to the site's origin**, in `connect-src`, next to the `frame-src` of the preview. `strapi::security` always sends `connect-src 'self' https:`, which covers a site served over HTTPS (and `http://localhost`, which the dev stack of [manual-testing.md](manual-testing.md) reads with no entry); a plain-HTTP site on another host, or a host whose proxy or distribution sends a stricter policy of its own, has to add the origin there. Without either condition the meter says it could not measure the page; **a publish does not depend on it**.

## The cost line in the edit view

The edit view of a page of a measured type has a side panel, **Weight of the blocks**, with a **Measure the page** button, the same number as the meter once it has measured ("4.4 kB of 60 kB"), the words for where it stands (calm under 90 %, "Close to the budget" from 90 %, "Over the budget" past 100 %), when it was measured and a link to the preview page, which has the whole meter. It measures **on demand**: opening an entry shows "Not measured yet" and renders nothing on the frontend. It is the weight of the **saved draft**, not of what is in the form. After a save it keeps the last number and says it is of an earlier save; press **Measure again** for the new one. The time is of this visit to the edit view: nothing is stored. It shows to a role that may preview drafts, for the types that have the **Preview** button.

The edit view holds no grant, so pressing **Measure** gets the editor's own as the preview page does: it asks the plugin for a preview token and loads the site with it in a frame that is never shown, reads the weight route with the cookie that frame set, and drops the frame. **Each press renders the draft once on the frontend** and costs one token request (the token route's limit of 20 a minute for each admin user applies); opening the edit view costs neither, and nothing refreshes the grant there. It needs what the meter needs (the site's `url`, `frame-src` and `connect-src`, the frontend's CORS answer) and shares its limit: where the browser sends no cookie to a frame of another site (Safari, [preview.md](preview.md)), the panel says the page could not be measured from the edit view and links to the preview, whose **Open in a new tab** works there. A previewed type that `budgets.contentTypes` does not list says it has no budget when **Measure** is pressed.

## When a publish is refused, in the Content Manager

A refused publish is told to the editor in a notification of the admin, "The page was not published", with a link to the preview page: for `pageOverBudget` the weight of the blocks, the budget, how far over it is and the three heaviest blocks; for `previewUnavailable` the cause the plugin gives (the site has no `url`, the frontend could not measure the page, or the draft was saved meanwhile). The text comes from the problem detail of `POST /micelio/transitions` ([api.md](../api.md)), and the admin never estimates. The notification is built, but **nothing in the admin calls the transitions route yet**: the control that does is bogd3v/micelio-plugin-core#57, which hands the answer to `useRefusalNotification` (`admin/src/hooks/`). Until then the refusal reaches the editor only as the answer of the API.

## Upgrade notes

- **Check that the admin's `connect-src` lets the browser reach the site's origin** (set it next to the `frame-src` of the preview if your host sends its own policy, or the site is plain HTTP on a host other than `localhost`): the cost meter and the cost line read the frontend's weight route from the editor's browser. Without it they say the page could not be measured; publishing is not affected. The host check does not look at it yet.
- The frontend must be at the release that answers the weight route to the editor's own grant (bogd3v/micelio#766).
- The plugin needs no new variable, route permission or migration. `POST /micelio/budget/measure` is new.
