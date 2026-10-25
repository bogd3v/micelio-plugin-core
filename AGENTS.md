# AGENTS.md

Instructions for coding agents working in this repository. Micelio's core as a Strapi 5 plugin: sites, blocks, the editorial workflow, hooks and the host check. It is published as `@micelio/strapi-plugin-core` and registers in Strapi as the plugin `micelio`.

## Engineering standard

The rules shared by every Micelio repository live in [`docs/engineering-standard.md`](docs/engineering-standard.md). This repository follows standard version 1.5 (`standard: 1.5`; `npm run lint:standard` checks the copy against the hashes bundled in `@micelio/eslint-config`). This file adds what is specific to this repository and never relaxes the standard. The copy is kept in step by the Micelio bot's `docs(standard): sync to X.Y` pull requests: review and merge them, do not edit the file by hand.

## The factory

Work moves through the gates of the Micelio factory: [`docs/factory.md`](https://github.com/bogd3v/micelio-engineering/blob/main/docs/factory.md) in `micelio-engineering`. The worker proves each acceptance criterion, and the verifier re-creates the run, on this repository's Docker: `compose.dev.yml` (`npm run dev:docker`, `docs/operate/manual-testing.md`) comes up from the branch, and `npm run check` runs in the `node:22` image (`.nvmrc`) on a clean copy of the worktree:

- `npm run test:admin` needs Chromium and its system libraries, which `node:22.23-slim` lacks: build a derived image with `npx playwright install-deps chromium` (as root) and keep the browser download in `HOME`.
- The copy needs no git: `npm run check` calls none. Copy the files without `node_modules`, `dist/` or `.env.docker`; mount the copy with `:z` on SELinux and set `HOME` to a writable folder inside it.
- Run the container as the host user (`--user "$(id -u):$(id -g)"`), or the copy fills with files owned by root. `npm run test:admin` also needs the browser and the system libraries of the slim image: as root, `npx playwright install --with-deps chromium` first, then give the copy back to your user. Keep the browser outside the copy (`PLAYWRIGHT_BROWSERS_PATH`) or run `test:admin` after `check`: `eslint .` lints a browser installed under the copy's `HOME`.
- `npm ci && npm run check`, then `npm run dev:docker -- down` to remove the stack and its volumes. `.env.docker` holds throwaway secrets: never print or commit it.

`.claude/agents/{planner,master,worker,reviewer,verifier}.md`, the skills `ship-pr`, `blind-review` and `verify-pr` and `.github/pull_request_template.md` are copies of `micelio-engineering/template/`: fix them there.

## Decisions

Why this repository exists and what it will hold is [ADR-0017](https://github.com/bogd3v/micelio/blob/main/docs/adr/0017-distribution-plugins-multisite-editorial.md) of `micelio`: Micelio's capabilities as Strapi plugins, `micelio-cms` as the reference distribution that installs them, several sites per CMS and an editorial workflow of Micelio's own. The block contract is [ADR-0018](https://github.com/bogd3v/micelio/blob/main/docs/adr/0018-blocks-as-a-contract.md). Product decisions are recorded in `micelio`; decisions only about this plugin go in `docs/adr/` here.

The plan is epic #1 and its milestone. Until its theme and fediverse milestones close, two rules hold:

- No content type is copied from `micelio-cms`. The content types move once, at the cut-over of release line 0.7.
- Nothing here touches `app/`, `modules/theme/` or `themes/` of `micelio` until bogd3v/micelio#402 closes.

## Commands

```bash
npm ci
npm run check            # typecheck, lint, format:check, test, lint:licenses, lint:standard and lint:reference
npm run dev:docker       # compose.dev.yml: a clean Strapi with the plugin, PostgreSQL and the frontend, seeded (docs/operate/manual-testing.md)
npm run build            # strapi-plugin build: dist/server and dist/admin
npm run dev              # strapi-plugin watch
npm run verify           # strapi-plugin verify: the package.json and the build a host will load
npm run test:admin       # the admin pages in Chromium, with an axe run (once: npx playwright install chromium)
npm run reference        # regenerate docs/hooks.md from the TSDoc of server/src/types/hooks.ts
npm run blocks:generate  # contract/blocks.schema.json and the reference in docs/blocks.md
npm run preview:generate # contract/preview.schema.json, from contract/preview.ts
```

`npm run test` builds the plugin first (`test/global-setup.ts`): the suites load `dist/`, as a host does.

## Structure

- `server/src/` — the server entry (`index.ts`, exported as `./strapi-server`): lifecycle phases, config, content types, controllers, services, routes, policies and middlewares, one folder each.
  - `content-types/site/` is `plugin::micelio.site`, one row per site (ADR-0017, section 4). Its components live in `components/site/` and register in `register.ts` under the category `micelio-site`: Strapi loads components only from the host, and `micelio-cms` 0.6 already owns `site.*`.
  - `migrations/` holds the boot steps: idempotent, name-based, run from `bootstrap.ts` (`default-site.ts` creates the default site on an empty instance; `block-catalogue.ts` compares the catalogue with the previous boot's and runs `blockCatalogueChanged`).
  - `site-scope/` is what makes a type site-scoped: `withSiteScope` (the required `site` relation), the `site-scope` route middleware in `middlewares/` (resolves the site of a content API request, answers `unknownSite`), and the document service middleware that filters and guards by site. `sites/rules.ts` keeps `hosts` and the single default site consistent. `docs/api.md` describes the behaviour.
  - `editorial/` is the editorial workflow (ADR-0017, section 5): `withEditorial` (the component and draft and publish), the state machine and default policy (`machine.ts`), `performTransition` (behind the `transitions` service and `POST /micelio/transitions`), the scheduler (`scheduler.ts`, a cron job on `scheduledPublishRule`), and the guard that refuses every other route to `publishedAt`. Its component lives in `components/editorial/`.
  - `host-check/` is the host check (ADR-0017, section 7): the checks as pure functions of the facts (`checks.ts`), what it reads from the running host (`facts.ts`) and the report (`report.ts`). The `hostCheck` service runs it from `bootstrap`; `docs/operate/host-check.md` lists the checks.
  - `status/` gathers what the status page shows (`read.ts`, behind the `status` service and `GET /micelio/status`; the service also runs the host check again for `POST /micelio/status/host-check`, one run at a time) and registers its admin permission, `plugin::micelio.status.read` (`permissions.ts`). `docs/operate/status-page.md` describes the page.
  - `preview/` is the preview (ADR-0019, section 3): `credentials.ts` makes and checks the preview token and grant (pure functions, no Strapi import: random, hashed, bound, 60 s and 15 min), `access.ts` finds a draft and checks that an admin user's abilities may read it, `revocation.ts` revokes on logout, `permissions.ts` registers `plugin::micelio.preview`. The `preview` service stores the credentials in the internal type `preview-credential` (`content-types/`, hidden from the Content Manager) behind `POST /micelio/preview/token` (admin) and `POST /api/micelio/preview/exchange` and `GET /api/micelio/preview/draft` (content API, the frontend's API token). `docs/operate/preview.md` is the flow and what the frontend needs.
  - `extensions/` is the registry behind the `extensions` service (ADR-0017): the four extension points a sibling plugin registers (`registerAdminPage`, `registerSiteSection`, `registerStatusChecks`, `registerExportSection`), declared in `types/extensions.ts`, a contract (section 6). `validate.ts` checks a registration, `checks.ts` runs a plugin's status checks, `site-sections.ts` gives every site an instance of each section. `controllers/extensions.ts` serves `GET /micelio/admin-pages` and `GET /micelio/sites`; `status/refresh.ts` is the daily cron job; `site-export/sections.ts` writes and reads the archive's `plugins/<id>/` folders. `docs/plugins/extension-points.md` is the how-to.
  - `hooks/` is the hooks registry behind `strapi.plugin('micelio').hooks` and the `hooks` service: registration, ordering and running a hook. The hooks and their payloads are declared in `types/hooks.ts`, a contract (section 6); `docs/hooks.md` is generated from its TSDoc and from that of `types/extensions.ts`. `performTransition` runs the transition hooks, so every path that publishes runs them; `sites/hooks.ts` runs `siteCreated`.
  - `site-export/` writes and reads the site archive of `docs/export-format.md`, behind the `siteExport` service: `exporter.ts` and `importer.ts`, the types and documents they share (`model.ts`), the export names and policies a type declares (`names.ts`), each attribute to the archive and back (`serialise.ts`, `deserialise.ts`), what an import checks before it writes (`archive.ts`, `import-plan.ts`), the media bytes (`media.ts`, `store-media.ts`) and a ustar writer and reader (`tar.ts`).
  - `utils/` holds pure helpers with no Strapi import (`problem.ts`, the problem details of section 4 of the standard; `block-catalogue.ts`, the fingerprint of the catalogue and its diff; `rate-limit.ts`, a fixed-window limiter kept in the process).
  - `constants/<domain>.ts` holds the constants shared by several files (`site.ts`: the UID, the component category; `status.ts`: the status permission; `preview.ts`: the permission, the credential type, the lifetimes and rate limits). With `types/<domain>.ts` (`host-check.ts`: the report the status page renders; `status.ts`: what `GET /micelio/status` answers; `preview.ts`: what a preview credential is bound to and what the routes answer; `hooks.ts`: the hooks API and its payloads) it is the shared folder of section 4 of the standard.
- `contract/` — the block catalogue (ADR-0018): `blocks.ts` (the 19 entries), `fields.ts` (the zod field builders), `strapi.ts` (a block's JSON Schema read back as Strapi attributes) and the generated `blocks.schema.json`, published as `./blocks.schema.json`. `GET /micelio/blocks` serves it; `docs/blocks.md` has the reference and how `cost` is measured. Next to it, `preview.ts` holds the zod schemas of the messages between the admin and the preview frame (ADR-0019, section 4) and the generated `preview.schema.json`, published as `./preview.schema.json`.
- `admin/src/` — the admin entry (`index.ts`, exported as `./strapi-admin`), the **Micelio** menu entry (`pages/MicelioLayout.tsx`: the sub-navigation, with the pages of sibling plugins from `GET /micelio/admin-pages` and the components they provide through `pageRegistry.ts`), the status page (`pages/StatusPage.tsx`), and its translations (`translations/en.json`, `es.json`; `messages.ts` reads them). It imports the server's types (`server/src/types/`) type-only, and nothing from `@strapi/icons`: that package cannot be required in Node (`components/StatusIcon.tsx`).
- `bin/micelio.js` — the package's `micelio` binary: `micelio doctor` loads the host project and prints the host check; `micelio export` writes a site archive and `micelio import` reads one (`docs/operate/export.md`).
- `compose.dev.yml`, `docker/cms/` — the stack for testing by hand (`npm run dev:docker`, `scripts/dev-docker.mjs`, which writes the gitignored `.env.docker`): a clean Strapi 5 project (`docker/cms/`, with the seed in `src/index.js` and a site-scoped fixture type, `src/api/note/`) that loads the working tree's `server/`, `admin/` and `contract/` mounted at `/plugin`, PostgreSQL and the published frontend image. Like `test/strapi/app/` it adds nothing of the distribution.
- `strapi-server.js`, `strapi-admin.js` — the same entries as files, for tools that do not read the `exports` of `package.json`.
- `test/` — the tests. `test/strapi/` boots a clean Strapi 5 on SQLite with only this plugin installed (`app/` is that Strapi; `harness.ts` starts and stops it). `test/package.test.ts` packs the package and loads both entries from the tarball. `test/export-format.test.ts` fails when a content type of its list has no row in `docs/export-format.md`, the site export format (a contract of section 6). The app adds fixture types made with the plugin's helpers, `app/src/api/note/` (`withSiteScope`) and `app/src/api/article/` (`withSiteScope` and `withEditorial`), `app/src/api/essay/` (the same, localised), and three for the export and import suites (`story`, `label`, `guest`, with the components of `app/src/components/`; `strapi/site-archive.ts` builds their site), and a fixture plugin, `app/src/plugins/hook-recorder/`, that records every hook it receives, and another, `app/src/plugins/extension-fixture/` (server and admin), that registers one of each extension point. `test/admin/` runs the admin pages in Chromium (`npm run test:admin`, its own `vitest.admin.config.mts`): its setup builds the test app's admin, the suite boots the harness with `SERVE_ADMIN_PANEL=true`, logs in and runs axe on the page (WCAG 2.2 A and AA), in English and, as an admin user whose language is Spanish, in Spanish (`app/src/admin/app.js` enables `es` in the admin). `fixtures/` holds the component JSON of `micelio-cms` the catalogue is tested against, and the script that regenerates it from a tag; it is never registered as a component.
- `scripts/` — `check-licenses.mjs` (`npm run lint:licenses`), `hooks-reference.mjs` (`npm run reference` and `lint:reference`), `release/version.mjs` (the release plan, read by the Release workflow), `blocks/` (`generate.ts`, behind `blocks:generate` and `lint:blocks`; `cost.mjs`, which measures `cost` on a build of `micelio`) and `preview/generate.ts` (behind `preview:generate` and `lint:preview`).
- `.github/workflows/` — `ci.yml`, `release.yml`, `pr-labels.yml` and `issue-ready.yml` (the check of a new or edited issue, a call to the reusable workflow of `micelio-engineering`); CI calls the reusable workflows of `micelio-engineering`, and runs `test:admin` and the `compose` job (the stack of `compose.dev.yml` must come up) in jobs of their own.

| Item                               | Convention                     | Example                                 |
| ---------------------------------- | ------------------------------ | --------------------------------------- |
| Plugin name, UID prefix            | `micelio`                      | `plugin::micelio.site`                  |
| Folders and files in `server/src/` | kebab-case                     | `content-types/site/schema.json`        |
| React components in `admin/src/`   | PascalCase                     | `components/Initializer.tsx`            |
| Other admin modules                | camelCase, as the SDK scaffold | `utils/getTranslation.ts`               |
| Tests                              | kebab-case, `.test.ts`         | `test/strapi/plugin-registered.test.ts` |

## Rules

- Hard limits: `.claude/TEAM.md`. Never push, merge, tag, release or deploy without the human's approval, and never read secrets.
- `micelio` in `package.json` is the release line of the core this version supports (section 7). Raise it in the pull request that adopts a new line.
- Content types are declared visible in the Content Manager and routes get an explicit prefix (ADR-0017, trade-offs); a test covers each. An internal store that holds no content and is never edited by hand (`preview-credential`, hashes only) is hidden instead, with `visible: false` tested.
- Every content type is made with `withSiteScope`, and its content API routes carry the `plugin::micelio.site-scope` middleware (ADR-0017, section 4).
- A publishable type is made with `withEditorial` and is published only through the `transitions` service. The states, the transitions and their default policy are a contract (section 6): adding one is a MINOR, renaming or removing one or changing a default is a MAJOR.
- The extension points are a contract too (section 6, "Plugin hooks API"): adding one is a MINOR, renaming or removing one or changing what a registration means is a MAJOR. A change to `server/src/types/extensions.ts` regenerates `docs/hooks.md` in the same pull request.
- The hooks are a contract too: adding one is a MINOR, renaming or removing one or changing a payload is a MAJOR. A payload is plain data, never a Strapi entity. A change to `server/src/types/hooks.ts` regenerates `docs/hooks.md` (`npm run reference`) in the same pull request; `lint:reference` fails otherwise.
- The block catalogue is a contract (section 6; ADR-0018, section 2): a change to `contract/blocks.ts` regenerates its schema and reference in the same pull request (`lint:blocks` fails otherwise), and a new tag of `micelio-cms` regenerates the fixture. The preview messages are one too (ADR-0019, section 4): a change to `contract/preview.ts` regenerates `preview.schema.json` in the same pull request (`lint:preview` fails otherwise); a breaking change raises the envelope `v`.
- Every user-facing string of the admin lands in `en` and `es` in the same pull request.
- The suites run on the clean Strapi of `test/strapi/app/`: Strapi's defaults and no other plugin. What the distribution adds (security middlewares, CSP, uploads provider) is never added there; the host check (#7) is what verifies it.
- Before 1.0.0 a breaking change raises `y` and everything else raises `z` (section 7). The bump is made by a `chore(release)` pull request before the tag.
