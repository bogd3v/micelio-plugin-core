# AGENTS.md

Instructions for coding agents working in this repository. Micelio's core as a Strapi 5 plugin: sites, blocks, the editorial workflow, hooks and the host check. It is published as `@micelio/strapi-plugin-core` and registers in Strapi as the plugin `micelio`.

## Engineering standard

The rules shared by every Micelio repository live in [`docs/engineering-standard.md`](docs/engineering-standard.md). This repository follows standard version 1.5 (`standard: 1.5`; `npm run lint:standard` checks the copy against the hashes bundled in `@micelio/eslint-config`). This file adds what is specific to this repository and never relaxes the standard. The copy is kept in step by the Micelio bot's `docs(standard): sync to X.Y` pull requests: review and merge them, do not edit the file by hand.

## Decisions

Why this repository exists and what it will hold is [ADR-0017](https://github.com/bogd3v/micelio/blob/main/docs/adr/0017-distribution-plugins-multisite-editorial.md) of `micelio`: Micelio's capabilities as Strapi plugins, `micelio-cms` as the reference distribution that installs them, several sites per CMS and an editorial workflow of Micelio's own. The block contract is [ADR-0018](https://github.com/bogd3v/micelio/blob/main/docs/adr/0018-blocks-as-a-contract.md). Product decisions are recorded in `micelio`; decisions only about this plugin go in `docs/adr/` here.

The plan is epic #1 and its milestone. Until its theme and fediverse milestones close, two rules hold:

- No content type is copied from `micelio-cms`. The content types move once, at the cut-over of release line 0.7.
- Nothing here touches `app/`, `modules/theme/` or `themes/` of `micelio` until bogd3v/micelio#402 closes.

## Commands

```bash
npm ci
npm run check            # typecheck, lint, format:check, test, lint:licenses, lint:standard and lint:reference
npm run build            # strapi-plugin build: dist/server and dist/admin
npm run dev              # strapi-plugin watch
npm run verify           # strapi-plugin verify: the package.json and the build a host will load
npm run reference        # regenerate docs/hooks.md from the TSDoc of server/src/types/hooks.ts
npm run blocks:generate  # contract/blocks.schema.json and the reference in docs/blocks.md
```

`npm run test` builds the plugin first (`test/global-setup.ts`): the suites load `dist/`, as a host does.

## Structure

- `server/src/` — the server entry (`index.ts`, exported as `./strapi-server`): lifecycle phases, config, content types, controllers, services, routes, policies and middlewares, one folder each.
  - `content-types/site/` is `plugin::micelio.site`, one row per site (ADR-0017, section 4). Its components live in `components/site/` and register in `register.ts` under the category `micelio-site`: Strapi loads components only from the host, and `micelio-cms` 0.6 already owns `site.*`.
  - `migrations/` holds the boot steps: idempotent, name-based, run from `bootstrap.ts` (`default-site.ts` creates the default site on an empty instance).
  - `site-scope/` is what makes a type site-scoped: `withSiteScope` (the required `site` relation), the `site-scope` route middleware in `middlewares/` (resolves the site of a content API request, answers `unknownSite`), and the document service middleware that filters and guards by site. `sites/rules.ts` keeps `hosts` and the single default site consistent. `docs/api.md` describes the behaviour.
  - `editorial/` is the editorial workflow (ADR-0017, section 5): `withEditorial` (the component and draft and publish), the state machine and default policy (`machine.ts`), `performTransition` (behind the `transitions` service and `POST /micelio/transitions`), the scheduler (`scheduler.ts`, a cron job on `scheduledPublishRule`), and the guard that refuses every other route to `publishedAt`. Its component lives in `components/editorial/`.
  - `host-check/` is the host check (ADR-0017, section 7): the checks as pure functions of the facts (`checks.ts`), what it reads from the running host (`facts.ts`) and the report (`report.ts`). The `hostCheck` service runs it from `bootstrap`; `docs/operate/host-check.md` lists the checks.
  - `hooks/` is the hooks registry behind `strapi.plugin('micelio').hooks` and the `hooks` service: registration, ordering and running a hook. The hooks and their payloads are declared in `types/hooks.ts`, a contract (section 6); `docs/hooks.md` is generated from its TSDoc. `performTransition` runs the transition hooks, so every path that publishes runs them; `sites/hooks.ts` runs `siteCreated`.
  - `utils/` holds pure helpers with no Strapi import (`problem.ts`, the problem details of section 4 of the standard).
  - `constants/<domain>.ts` holds the constants shared by several files (`site.ts`: the UID, the component category). With `types/<domain>.ts` (`host-check.ts`: the report the status page renders; `hooks.ts`: the hooks API and its payloads) it is the shared folder of section 4 of the standard.
- `contract/` — the block catalogue (ADR-0018): `blocks.ts` (the 19 entries), `fields.ts` (the zod field builders), `strapi.ts` (a block's JSON Schema read back as Strapi attributes) and the generated `blocks.schema.json`, published as `./blocks.schema.json`. `GET /micelio/blocks` serves it; `docs/blocks.md` has the reference and how `cost` is measured.
- `admin/src/` — the admin entry (`index.ts`, exported as `./strapi-admin`) and its translations (`translations/en.json`, `es.json`).
- `bin/micelio.js` — the package's `micelio` binary: `micelio doctor` loads the host project and prints the host check.
- `strapi-server.js`, `strapi-admin.js` — the same entries as files, for tools that do not read the `exports` of `package.json`.
- `test/` — the tests. `test/strapi/` boots a clean Strapi 5 on SQLite with only this plugin installed (`app/` is that Strapi; `harness.ts` starts and stops it). `test/package.test.ts` packs the package and loads both entries from the tarball. `test/export-format.test.ts` fails when a content type of its list has no row in `docs/export-format.md`, the site export format (a contract of section 6). The app adds two fixture types made with the plugin's helpers, `app/src/api/note/` (`withSiteScope`) and `app/src/api/article/` (`withSiteScope` and `withEditorial`), and a fixture plugin, `app/src/plugins/hook-recorder/`, that records every hook it receives. `fixtures/` holds the component JSON of `micelio-cms` the catalogue is tested against, and the script that regenerates it from a tag; it is never registered as a component.
- `scripts/` — `check-licenses.mjs` (`npm run lint:licenses`), `hooks-reference.mjs` (`npm run reference` and `lint:reference`), `release/version.mjs` (the release plan, read by the Release workflow) and `blocks/` (`generate.ts`, behind `blocks:generate` and `lint:blocks`; `cost.mjs`, which measures `cost` on a build of `micelio`).
- `.github/workflows/` — `ci.yml`, `release.yml` and `pr-labels.yml`; CI calls the reusable workflows of `micelio-engineering`.

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
- Content types are declared visible in the Content Manager and routes get an explicit prefix (ADR-0017, trade-offs); a test covers each.
- Every content type is made with `withSiteScope`, and its content API routes carry the `plugin::micelio.site-scope` middleware (ADR-0017, section 4).
- A publishable type is made with `withEditorial` and is published only through the `transitions` service. The states, the transitions and their default policy are a contract (section 6): adding one is a MINOR, renaming or removing one or changing a default is a MAJOR.
- The hooks are a contract too: adding one is a MINOR, renaming or removing one or changing a payload is a MAJOR. A payload is plain data, never a Strapi entity. A change to `server/src/types/hooks.ts` regenerates `docs/hooks.md` (`npm run reference`) in the same pull request; `lint:reference` fails otherwise.
- The block catalogue is a contract (section 6; ADR-0018, section 2): a change to `contract/blocks.ts` regenerates its schema and reference in the same pull request (`lint:blocks` fails otherwise), and a new tag of `micelio-cms` regenerates the fixture.
- Every user-facing string of the admin lands in `en` and `es` in the same pull request.
- The suites run on the clean Strapi of `test/strapi/app/`: Strapi's defaults and no other plugin. What the distribution adds (security middlewares, CSP, uploads provider) is never added there; the host check (#7) is what verifies it.
- Before 1.0.0 a breaking change raises `y` and everything else raises `z` (section 7). The bump is made by a `chore(release)` pull request before the tag.
