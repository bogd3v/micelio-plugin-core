# Page budgets

A page of a type that `budgets.contentTypes` lists (by default the types the frontend previews) is measured when it is published, and publishing it is refused when its blocks weigh more than its budget. The measurement is the frontend's: the plugin has it render the draft and reads what it says, and never estimates. The decision is [ADR-0019](https://github.com/bogd3v/micelio/blob/main/docs/adr/0019-visual-editing-protocol.md), amendment of 2026-10-25; the weight report is `docs/performance.md`, "Weight of a draft", in `micelio`; the error is in [api.md](../api.md).

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

The preview page will show the same measurement while the editor writes, in a cost meter (bogd3v/micelio-plugin-core#106). It is not part of the refusal: a publish measures the draft itself.
