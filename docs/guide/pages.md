# Page settings

A page has settings of its own beside its blocks: its address, its type and where it shows up.
You change them in the **Page settings** drawer of the builder, and a host turns them on for its
page type with `withPageSettings`.

## Turn them on

`withPageSettings(schema)`, exported beside `withEditorial` from the plugin's server entry, adds
these attributes to a content type:

- `pageType`, a string. The core's page types are `landing`, `standard` and `long-read`, and the
  site's budgets may name more ([Page budgets](../operate/budgets.md)).
  A page of a type nobody configured has the `standard` budget.
- `visibility`, the component `micelio-page.visibility` with `inMenu`, `inSitemap` and `noindex`.
  A page that was never saved with it shows in the menu and the sitemap and is indexable.

- `templateId`, a string, `templateVersion`, an integer, and the private JSON lists
  `templateSamples` and `templateFixed`: the template the page was created from, the version it
  had, the sample texts the page copied and has not replaced yet, and the blocks the template fixed
  (`{ block, nth }`) ([Page templates](templates.md)). Nothing writes them by hand: the gallery and
  the Template tab do, and a page made without a template leaves them empty.

None is localised: they describe the page, not one language of it.

```js
// src/api/page/content-types/page/schema.js
const {
  withEditorial,
  withPageSettings,
  withSiteScope,
} = require('@micelio/strapi-plugin-core/strapi-server')

module.exports = withSiteScope(withEditorial(withPageSettings({/* the schema */})))
```

Apply `withSiteScope` and `withEditorial` as well: the redirects below are written by the
`transitions` service, and the budget is measured when a page is published.
The type needs a `slug` attribute for the redirects. `docker/cms` and the test app apply it;
`micelio-cms` applies it to `api::page.page` (bogd3v/micelio-cms#414).

## Open the drawer

In the builder, press the gear next to the page title, or `⌘,` (`Ctrl+,` elsewhere).
The preview stays in view behind it. `Esc` or **Close** shuts it, and focus goes back to the gear.
A page type made without `withPageSettings` has no gear.

The **General** tab has:

- **Site** and **Locale**, read only: a page does not move to another site or language here.
- **Slug.** It is saved when you leave the field or press `Enter`. A slug uses letters, digits and
  `- _ . ~`, with no slash or space.
- **Page type.** The types of the site, from the lightest budget to the heaviest. It sets the
  weight budget and which blocks the palette offers, and changing it measures the page again: the
  meter in the toolbar shows the new budget. A page over the budget of its new type still saves.
  Publishing it is what is refused (`pageOverBudget`), not saving it.
- **Visibility.** In the navigation menu, in the sitemap and feeds, hidden from search engines
  (`noindex`). The frontend reads them; the plugin only stores them.
- **Redirects** to the page's live address, each with **Remove**.

Every choice is saved with the draft, over the version the builder holds, so a save from another
session is still reported as a conflict
([Two people on one page](builder.md#two-people-on-one-page)).
**Save as template…** in the footer saves the page as a template ([Page templates](templates.md)).
The other tabs of the design (SEO and social, Template) have their own issues.

## When the slug changes

Changing a slug of a draft changes no address: the live page still answers on the old one.
When you publish, the plugin writes a **301 redirect** from the old address to the new one, in the
same transaction as the publish ([Redirects](../api.md#redirects)).
If the redirect cannot be written, the page is not published and keeps its live address.

- A page that was never published has no address to keep, so it gets no redirect.
- Older redirects to the page follow it to the new address: a visitor is redirected once.
- If a page returns to an address it left, the redirect from that address is removed.
- **Remove** in the drawer deletes a redirect for good. The page's old address then answers as the
  frontend answers a page that does not exist.

The frontend reads the list with `GET /api/micelio/redirects?site=<slug>` and answers the redirects
(bogd3v/micelio#733). Give its API token the permission `plugin::micelio.redirects.find`.
