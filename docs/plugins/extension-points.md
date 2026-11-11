# Extension points for sibling plugins

**Kind:** how-to. How a Micelio plugin (the fediverse plugin is the first) appears in the Micelio admin and in the site archive without an admin of its own: a page in the sub-navigation, a settings section on every site, checks in the Status page and files in the archive. The reference, generated from the TSDoc, is [Extension points in hooks.md](../hooks.md#extension-points); this page is the order to do things in.

Everything is registered on the core's `extensions` service. Get it in your plugin's `register`:

```js
// server/src/register.js of your plugin
module.exports = ({ strapi }) => {
  const extensions = strapi.plugin('micelio').service('extensions')
  // …registrations below
}
```

Use `service('extensions')`, not a property: Strapi does not order plugins by dependency, and the service exists from the start (as `service('hooks')` does).

Rules that hold for the four points:

- Every registration has an `id` of lower case letters, digits and hyphens, unique among registrations of that kind. A malformed or repeated registration throws a `TypeError` that names the field, so your plugin fails at boot.
- Every text is `{ en, es }`. The core shows the admin user's language and falls back to `en`. Put `missingLocales(text)` (exported by `@micelio/strapi-plugin-core/strapi-server`) in your own test to fail when one is missing.
- Every registration carries `permission`, an admin action your plugin registered (`plugin::fediverse.read`). The core shows nothing to a role without it and never widens it. Register the actions in your `bootstrap` as Strapi plugins do (`strapi.service('admin::permission').actionProvider.registerMany`).
- Nothing runs, and no request is made, when an admin page loads.

## A page in the sub-navigation

```js
extensions.registerAdminPage({
  id: 'fediverse',
  group: 'site', // 'overview', 'content' or 'site'
  label: { en: 'Fediverse', es: 'Fediverso' },
  to: 'fediverse', // /admin/plugins/micelio/fediverse
  permission: 'plugin::fediverse.read',
})
```

`to` cannot be `about`: the core's About page uses it, and the registration throws a `TypeError`. The core's Export and import page lives at `_export-import`, which `to` can never be (it starts with an underscore), but the core's own routes win over a plugin's page: `review`, `blocks`, `sites`, `templates` (and `templates/<id>/edit`), `preview/…`, `builder/…` and `new/…`. The registration does not throw for them; the core route answers and your page is never shown, so choose another `to` (the core's Sites page is described below). The index (Status) is the empty path, which `to` never matches.

The item appears in its group of the Micelio sub-navigation (`GET /micelio/admin-pages` lists those the admin user's permissions allow). Provide the page itself from your admin, in `bootstrap` (the Micelio admin plugin is registered by then, whatever the order):

```js
// admin/src/index.js of your plugin
export default {
  register(app) {
    app.registerPlugin({ id: 'fediverse', name: 'fediverse' })
  },
  bootstrap(app) {
    app.getPlugin('micelio').apis.registerPage('fediverse', () => import('./pages/Fediverse'))
  },
}
```

The first argument is the registration's `id`; the loader returns a module whose default export is the page component. Do not call `addMenuLink`: your plugin has no menu entry of its own. A path with no page provided shows a notice, not an error.

The Micelio menu entry needs no permission, so a role that has only your plugin's permission reaches the sub-navigation and sees your item, with About Micelio.

## A section on every site

```js
extensions.registerSiteSection({
  id: 'fediverse-actor',
  component: 'fediverse.actor', // already in strapi.components
  label: { en: 'Fediverse actor', es: 'Actor del fediverso' },
  panel: 'fediverse.actor',
  permission: 'plugin::fediverse.read',
})
```

Do it in `register`: Strapi builds the database models after it, and a later call throws. The component must be in Strapi's registry first (the host's `src/components`, or `strapi.get('components').add(…)` as the core does). The core adds it to `plugin::micelio.site` as a non-repeatable component, so there is one instance per site:

- A site created afterwards gets an empty instance (`{}`) unless its creator supplies one, so give every attribute a default.
- At each boot, a site that has none (it predates your plugin) gets one.
- `GET /micelio/sites` answers `sections['fediverse-actor']` with each site only for a caller who has `permission` ([api.md](../api.md#sites-in-the-admin)).
- The site archive carries the instance with the site, as any attribute of the site type.
- The attribute is `private`: the content API (`/api/micelio/sites?populate=*`, or `populate=site` from a site-scoped type) never returns it, so your `permission` is not bypassed there. The Content Manager still lists it for a role that can read the `Site` type: restrict the field in that role's Content Manager permission (`fields`) if the section must be hidden there too. The core does not do it.

`panel` names the panel your admin offers on the **Sites** page (Micelio → Sites, in the `site` group of the sub-navigation, for a role that may read the `Site` type). The page shows one site at a time, with its core fields as links to its Content Manager entry and, under them, a card for each section of yours the caller may read. Provide the component in your admin's `bootstrap`, with the Micelio admin plugin's `apis`, as you do for a page:

```js
// admin/src/index.js of your plugin
bootstrap(app) {
  app.getPlugin('micelio').apis.registerSitePanel('fediverse.actor', () => import('./panels/Actor'))
},
```

The first argument is the registration's `panel`; the loader returns a module whose default export is a component that receives `{ site, section, canWrite }`: the site's `documentId` and `slug`, the section's current data (`null` if the site has none yet) and whether the caller may update the `Site` type. Save through the Content Manager's API with your own permission checks; the page does not save for you. The loader runs only when the page renders the panel, and the page renders it only for a caller who has the section's `permission`: no request is made and no module is fetched for a section the caller cannot read. A `panel` with no registered component shows a notice that links to the site's Content Manager entry, not an error. The core's Sites page lives at `sites`. `registerAdminPage` does not throw for `to: 'sites'`: the registration is accepted, but the core route answers that path, so the page you provide is never shown. Choose another `to`.

## Checks in the Status page

```js
extensions.registerStatusChecks({
  id: 'fediverse',
  label: { en: 'Fediverse', es: 'Fediverso' },
  permission: 'plugin::fediverse.read',
  async run(site) {
    // site is { documentId, slug }
    return [
      {
        id: 'webfinger',
        title: { en: 'WebFinger answers', es: 'WebFinger responde' },
        status: 'ok', // 'ok', 'warn' or 'fail'
        detail: { en: '…', es: '…' }, // optional
        fix: { en: '…', es: '…' }, // optional
      },
    ]
  },
})
```

The core calls `run` once per site on **Run host check** and on the daily refresh (`statusRefreshRule`, README), never when the page loads. Results show as a card per plugin in Status, and as a line per plugin (`fediverse: 1 ok, 0 warn, 0 fail`) in **Copy diagnostics**. A `run` that throws, returns a malformed result or takes more than ten seconds becomes one failed check, `run`; the cause is logged and is not in the answer. `GET /micelio/status` carries the latest results under `plugins[<id>]` ([api.md](../api.md#status)).

## Files in the archive

```js
extensions.registerExportSection({
  id: 'fediverse',
  version: '1.0',
  personalData: true,
  label: { en: 'Fediverse followers and keys', es: 'Seguidores y claves del fediverso' },
  permission: 'plugin::fediverse.manage',
  async *write(site) {
    yield { path: 'blocked.json', body: JSON.stringify(await blockedFollowers(site)) }
  },
  async read(site, entries) {
    // entries: [{ path: 'blocked.json', body: Buffer }]
    return { imported: entries.length, skipped: 0 }
  },
})
```

The archive carries your files under `plugins/<id>/` and your `version` in `manifest.plugins` ([export-format.md](../export-format.md#plugin-sections)). A section with `personalData: true` is left out unless it is asked for by id: `npx micelio export <site> --include fediverse`, and every such export is logged. Whoever offers the choice to an admin user (the export dialog) must check `permission` first; the CLI has no user. On import, `read` runs inside the import's transaction after the core's content, so a throw refuses and rolls back the whole import. An archive section nobody registered, or of another major version, is reported under `skippedPlugins` and skipped, never an error.

## Test it

The core's own suites use a fixture plugin that registers one of each point (`test/strapi/app/src/plugins/extension-fixture/`), with a panel for its `fixture-profile` section and a second section whose panel is never registered; copy its shape for yours. `npm run dev:docker` loads it too ([manual-testing.md](../operate/manual-testing.md#try-the-sites-page)).
