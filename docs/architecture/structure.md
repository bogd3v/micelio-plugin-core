# How the repository is laid out

The long descriptions of the subsystems that `AGENTS.md` summarises. Read the section of the area you change; `AGENTS.md` keeps the rules and the pointers.

## Preview

`preview/` is the preview (ADR-0019, section 3): `credentials.ts` makes and checks the preview token, grant and system grant (pure functions, no Strapi import: random, hashed, bound, 60 s, 15 min and 60 s), `access.ts` finds a draft and checks that an admin user's abilities may read it, `draft-query.ts` is the draft read: an allowlist for its query (only `populate`; a relation goes one level, a media attribute only `fields`), a related entry read as published, and the populated relations kept to the grant's site, `revocation.ts` revokes on logout, before the logout answers, `permissions.ts` registers `plugin::micelio.preview`, `shortcut.ts` answers Strapi's own "Open preview" button with the admin page, unless the host configured `admin.preview`. The `preview` service stores the credentials in the internal type `preview-credential` (`content-types/`, hidden from the Content Manager) behind `POST /micelio/preview/token` (admin) and `POST /api/micelio/preview/exchange` and `GET /api/micelio/preview/draft` (content API, the frontend's API token). A system grant has no admin user and holds the draft's version: only plugin code mints one (`issueSystemGrant`, for the budget at publish), no route does. `docs/operate/preview.md` is the flow and what the frontend needs.

## Page weight budget

`budget/` is the page weight budget (ADR-0019, amendment of 2026-10-25): `rules.ts` (pure: the budget of a page type and site, the excess, the report's schema, which types are measured), `weight-client.ts` (the request to the frontend's weight route with a system grant: no redirect, bounded retries on `429`, fail closed). The `budget` service measures a draft and `performTransition` calls it on every publish of a type that `budgets.contentTypes` lists (by default `api::page.page` and `api::article.article`, the types the frontend previews; the default is applied in code, not in the config's defaults, since Strapi merges arrays index by index) and that is site-scoped, editorial and has a dynamic zone, refusing with `pageOverBudget` or `previewUnavailable`; `POST /micelio/budget/measure` (`controllers/budget.ts`) serves the cost meter with the report the admin read from the frontend with the editor's own grant, and mints no grant. The budgets are `budgets` in the plugin's config. `docs/operate/budgets.md` is the how-to.

## Page settings and redirects

`page-settings/` is what a host's page type gains with `withPageSettings`
(bogd3v/micelio-plugin-core#52, [the guide](../guide/pages.md)): `index.ts` adds `pageType` and
the `visibility` component (`components/page/`, category `micelio-page`, registered like the
editorial one), `redirects.ts` is pure (what a change of address does to the redirects of a
page: write one, point the older ones at the new address, drop the one from an address the page
returns to) and `record.ts` writes them through the document service. `performTransition` calls
`record.ts` inside one `strapi.db.transaction` with the publish, so a redirect that cannot be
written leaves the page at its live address. `plugin::micelio.redirect`
(`content-types/redirect/`, visible in the Content Manager, exported as `redirects.json` and not as a content type) is keyed by site;
its `rule` is `slug-change` (`createdBy` is Strapi's own audit relation).
`controllers/redirects.ts` answers the content API list with its `ETag`.
`documents.ts` is the document service middleware that refuses a redirect whose `from` or `to`
is not a path of the site (`isSitePath` in `redirects.ts`: one `/`, no `//`, no backslash, no
scheme, no control character) on `create`, `update` and `clone`; the list never serves a row that fails it.

## Block settings

`block-settings/` is what a site manages of the catalogue (#51; `docs/operate/block-catalogue.md`).
`rules.ts` is pure: it checks a setting against the contract (`findSettingViolation`), merges a
site's defaults over the core's (`mergedOptions`), finds the catalogue blocks in the data of a
document wherever they sit (`blockIdsIn`: dynamic zones, component attributes and the parts
nested in a component) and decides which of them a save may not add (`findBlockNotAllowed`: an
addition is more of a block than the stored draft holds). `check.ts` reads the site's settings and
the stored draft for one write and is the one check behind both `documents.ts`, the document
service middleware on `create`, `update` and `clone`, and the dry run of an import
(`site-export/import-plan.ts`), so an archive is refused before anything is written. The same
middleware validates the writes to `plugin::micelio.block-setting`. `error.ts` has
`BlockNotAllowedError` and `BlockSettingError`, which the `site-scope` route middleware (content
API) and `controllers/block-settings.ts` (admin) answer as problem details. The `blockSettings`
service (`services/block-settings.ts`) reads and writes the rows through the document service,
builds the merged view of `GET /micelio/blocks?site=` and the Block catalogue page's view, and
scans the site's pages for the blocks they hold (database only). `permissions.ts` registers
`plugin::micelio.blocks.read` and `.manage`. The type has `export: never` and is hidden from the
Content Manager: the page is its editor.

## Page templates

`page-templates/` is what a template is made of (#54, [the guide](../guide/templates.md)).
`rules.ts` is pure: `shapeContent` keeps the options, the settings and, for `sample`, the text of a
block's stored content, never a file or a link, reading the component's attributes (applying it to
its own result changes nothing); `samplesOf` and `findSampleText` are the sample texts a page
copies and the blocks that still hold them; `costKbOf`, `thumbnailOf` and `parseTemplateDocument`
are the structure's weight, its thumbnail and the read of an exported file. `check.ts` reads a
draft for `performTransition`, which refuses `sampleTextPresent`. The `pageTemplates` service
(`services/page-templates.ts`) runs the checks (`evaluate`: options, budget, scope over every site,
name), stores the template through the document service and makes a page from one;
`controllers/page-templates.ts` checks the permissions and answers the problem details.
`permissions.ts` registers `plugin::micelio.templates.manage`. A CMS-wide template is a row of the
site that saved it with `scope: cms`, so the type keeps `withSiteScope`. `withPageSettings` adds
`templateId`, `templateVersion` and the private `templateSamples` to a page type. The admin has
`components/SaveTemplateDialog.tsx` (opened from the page settings drawer),
`pages/TemplatesGalleryPage.tsx` at `new/:uid` (opened by the create view's
`components/NewFromTemplateAction.tsx`) and `components/TemplateThumbnail.tsx`; the builder greys
the sample texts of `BuilderDocument.samples`.

## Site export and import

`site-export/` writes and reads the site archive of `docs/export-format.md`, behind the `siteExport` service: `exporter.ts` (with its `scope`) and `importer.ts`, `dry-run.ts` (`preview`: what an import would do, written nowhere), `inspect.ts` (the decision for one document, shared by the import and its dry run), `keep-both.ts` (the policy that gives the archive's documents ids of their own), the types and documents they share (`model.ts`), the export names and policies a type declares (`names.ts`), each attribute to the archive and back (`serialise.ts`, `deserialise.ts`), what an import checks before it writes (`archive.ts`, `import-plan.ts`), the media bytes (`media.ts`, `store-media.ts`) and a ustar writer and reader (`tar.ts`).

## Admin

`admin/src/` — the admin entry (`index.ts`, exported as `./strapi-admin`), the **Micelio** menu
entry (no permission of its own; `pages/MicelioLayout.tsx`: the sub-navigation, with the core's
items from `navigation.ts`, each shown to a role with its permission, and the pages of sibling
plugins from `GET /micelio/admin-pages` and the components they provide through `pageRegistry.ts`),
the status page (`pages/StatusPage.tsx`), Export and import (`pages/TransferPage.tsx` with
`components/ExportPanel.tsx` and `ImportPanel.tsx`, `utils/transfer.ts`) and About
(`pages/AboutPage.tsx`, which shows what `GET /micelio/about` gathers), the preview page (ADR-0019;
`pages/PreviewPage.tsx` at `preview/:uid/:documentId`, which no menu item opens: the **Preview**
button of the Content Manager's edit view does, `components/PreviewHeaderAction.tsx`, registered in
`bootstrap` and shown by `utils/previewAction.ts` for a site-scoped type with a dynamic zone; with
`components/PreviewFrame.tsx`, which also tells the page when a loaded frame stayed silent
(`READY_WAIT_SECONDS`) for the notice and **Open in a new tab**, `hooks/useEntry.ts`,
`hooks/usePreviewSource.ts` (the token request, for the frame and for the new tab) and the pure
helpers of `utils/previewPane.ts`; `docs/operate/preview.md`), whose entry column carries the cost
meter (`components/CostMeter.tsx`, `hooks/useBudget.ts`, which reads the weight route of the site
once the frame holds the grant, the pure thresholds of `utils/costMeter.ts`), the cost line in the
edit view's side panel (`components/CostPanelAction.tsx`, registered in `bootstrap` with
`addEditViewSidePanel`, and `CostPanel.tsx`, which measures on demand, `docs/operate/budgets.md`),
and the review flow (#57: `components/builder/ReviewActions.tsx`, the builder's editorial buttons
and their dialogs; `pages/ReviewPage.tsx`, the In review page; `hooks/useTransition.ts`, which asks
`POST /micelio/transitions` and shows a refusal or a warning as a notification with a link to the
block; the pure helpers of `utils/review.ts`, which read a budget refusal with `utils/refusal.ts`;
`docs/guide/review.md`), and its translations (`translations/en.json`, `es.json`; `messages.ts`
reads them). It imports the server's types (`server/src/types/`) type-only, and nothing from
`@strapi/icons`: that package cannot be required in Node (`components/MicelioIcon.tsx`, the mark of
the menu entry).

### Builder

The builder page (issue #49, [the guide](../guide/builder.md)) is `pages/BuilderPage.tsx` at
`builder/:uid/:documentId`. It is split by concern:

- `components/builder/` has one file for each panel: `Palette`, `BlockList`, `BlockPanel`,
  `Overlay` (what the admin draws over the frame), `BuilderHeader`, `layout` and `Motion`
  (the tokens of the Motion artboard), and `IslandBadge` (issue #56: the one mark of an island in
  the palette, the block list, the preview and the panel, in the design's `secondary` blue, which
  nothing else in the builder uses),
  `PageSettingsDrawer` (the General tab of the page
  settings, [the guide](../guide/pages.md)) and `controls` (the segmented choice and the icon
  button the panels share). `MediaInputs` is the panel's media fields (#133): it opens
  the Media Library dialog the upload plugin registers as `components['media-library']` (read with
  `useStrapiApp`, the admin's public API) and writes an image's alternative text to the file with
  `PUT /upload/files/:id`; it never uploads. `fieldStyle` holds what the panel's fields share
  (the label, the text field).
- `hooks/useBuilderDocument.ts` reads the draft and autosaves it: each save names the version it
  read (`X-Micelio-Expected-Version`, checked by `server/src/document-version/`, see
  [Saving over a version](../api.md#saving-over-a-version)), and a block that lacks a required
  field holds the save. `useBuilderCatalogue.ts` reads the site's merged
  catalogue (`GET /micelio/blocks?site=`) and the components of the Content Manager.
  `useBuilderFrame.ts` is the conversation with the frame (phase 2 of the protocol),
  `useBuilderEdits.ts` the changes, `useBlockLookup.ts` what the catalogue says of each block
  of the page, and `useRefusalNotice.ts` the notification of a refused save
  (the way to the block it names is a button in `BuilderPage`). `saveSettings` of
  `useBuilderDocument` saves the page's slug, type and visibility over the same version, and
  `usePageSettings.ts` reads what the drawer shows around them: the site's page types
  (`GET /micelio/budget/page-types`), the live slug and the redirects (the Content Manager's
  routes for `plugin::micelio.redirect`).
- `utils/builder/` is pure: the document model, the fields of the panel, the palette, the
  overlay's geometry, the messages, the undo history, the reading of a refusal and `islands.ts`
  (what the badge and the panel say of a block's island, from `contract/islands.ts`).
- The render mode of an island (issue #56) is state of the page, by block key, never saved:
  `BuilderPage` sends `micelio:renderMode` when the island label's toggle changes it and again
  for each toggled block after the frame's next `ready`, as the amendment of ADR-0019
  (2026-11-04) says.
- `components/PreviewFrame.tsx` gives the page the messages of the frame in view
  (`onMessage`), posts to it (`post`) and holds the overlay inside its stage.

A block is addressed by its position among the blocks of the zone at a version (`blocksAt` keeps
the blocks of each saved version, the ones the catalogue no longer lists included), so a message
is mapped through the version it names and not through the page's current list. The builder
composes the zone `sections` only, as the protocol addresses it.

## The dev stack

`compose.dev.yml`, `docker/cms/` — the stack for testing by hand (`npm run dev:docker`, `scripts/dev-docker.mjs`, which writes the gitignored `.env.docker`): a clean Strapi 5 project (`docker/cms/`, with the seed in `src/index.js` and fixture types, `src/api/note/` (`withSiteScope`), `src/api/article/` (`withSiteScope` and `withEditorial`, with the attributes of the `article` of `micelio-cms` that the frontend populates, and `src/api/author/`; the seed creates a draft article with a cover and an author) and `src/api/page/` with `category` and `tag` (the shape of the `page` of `micelio-cms`, which the frontend previews; `dev.mjs` writes the sections' schemas into the gitignored `src/components/` from `test/fixtures/`, and the seed creates a draft landing with an island, and a draft whose two islands lack their static alternative)) that loads the working tree's `server/`, `admin/` and `contract/` mounted at `/plugin`, PostgreSQL and the frontend image (`FRONTEND_IMAGE`; the published one by default; the page budget needs one with the weight route). Two forwards (`docker/cms/forward.mjs`) make the site's `url` and the media URL, which are browser addresses, answer inside the containers: the CMS reaches the frontend through `dev.mjs`, the frontend reaches the CMS through the `media-forward` service. Like `test/strapi/app/` it adds nothing of the distribution.

## Tests

`test/` — the tests. `test/strapi/` boots a clean Strapi 5 on SQLite with only this plugin installed (`app/` is that Strapi; `harness.ts` starts and stops it). `test/package.test.ts` packs the package and loads both entries from the tarball. `test/export-format.test.ts` fails when a content type of its list has no row in `docs/export-format.md`, the site export format (a contract of section 6). The app adds fixture types made with the plugin's helpers, `app/src/api/note/` (`withSiteScope`) and `app/src/api/article/` (`withSiteScope` and `withEditorial`), `app/src/api/essay/` (the same, localised), `app/src/api/landing/` (the same, with the sections of `page`: the type the cost meter's browser suite measures), `app/src/api/guide/` (the same, made with `withPageSettings` too, localised, never exported: the page settings and redirects suites), `app/src/api/memo/` (editorial with a slug but no page settings: the type that writes no redirect), `app/src/api/showcase/` (the same, with the scene and the `playground` block: the type the islands' suites use), `app/src/api/post/` (draft and publish, with a cover, a component, a dynamic zone and relations, one to its own type: the draft read's populate; `label` has routes for the token that reads it), and three for the export and import suites (`story`, `label`, `guest`, with the components of `app/src/components/`; `strapi/site-archive.ts` builds their site), and a fixture plugin, `app/src/plugins/hook-recorder/`, that records every hook it receives, and another, `app/src/plugins/extension-fixture/` (server and admin), that registers one of each extension point. `test/admin/` runs the admin pages in Chromium (`npm run test:admin`, its own `vitest.admin.config.mts`): its setup builds the test app's admin, the suite boots the harness with `SERVE_ADMIN_PANEL=true`, logs in and runs axe on the page (WCAG 2.2 A and AA), in English and, as an admin user whose language is Spanish, in Spanish (`app/src/admin/app.js` enables `es` in the admin). `test/fixtures/` holds the component JSON of `micelio-cms` the catalogue is tested against, and the script that regenerates it from a tag; the plugin never registers it as a component (only the dev stack's `dev.mjs` writes it into its own host). `test/fixtures/micelio-populate.ts` holds the frontend's `ARTICLE_POPULATE` and `PAGE_POPULATE`, copied verbatim with the commit they come from; `test/preview-frontend-populate.test.ts` runs the draft read's allowlist on them, and the suite `strapi/preview-populate.test.ts` serves their `localizations`. `test/strapi/preview-site.ts` is the stub frontend of the preview suite: the real exchange and draft routes, a page that says `ready` and answers `load-draft`, and a weight route; the app's `src/api/page/` is its fixture. `test/strapi/weight-site.ts` is the stub's weight route (it redeems the system grant with the real CMS and answers a report you shape); `startWeightSite` is the whole stub frontend of `strapi/budget.test.ts` and of the export fixture, which publishes a story and so is measured.

The review suites (#57) add `app/src/api/brochure/` (editorial, with page settings, never exported,
whose sections hold `section.cta` and its `section.link`: the `linkToDraft` warning).
