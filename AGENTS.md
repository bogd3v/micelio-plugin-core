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
npm run check            # typecheck, lint, format:check, test, lint:licenses and lint:standard
npm run build            # strapi-plugin build: dist/server and dist/admin
npm run dev              # strapi-plugin watch
npm run verify           # strapi-plugin verify: the package.json and the build a host will load
```

`npm run test` builds the plugin first (`test/global-setup.ts`): the suites load `dist/`, as a host does.

## Structure

- `server/src/` — the server entry (`index.ts`, exported as `./strapi-server`): lifecycle phases, config, content types, controllers, services, routes, policies and middlewares, one folder each.
- `admin/src/` — the admin entry (`index.ts`, exported as `./strapi-admin`) and its translations (`translations/en.json`, `es.json`).
- `strapi-server.js`, `strapi-admin.js` — the same entries as files, for tools that do not read the `exports` of `package.json`.
- `test/` — the tests. `test/strapi/` boots a clean Strapi 5 on SQLite with only this plugin installed (`app/` is that Strapi; `harness.ts` starts and stops it). `test/package.test.ts` packs the package and loads both entries from the tarball.
- `scripts/` — `check-licenses.mjs` (`npm run lint:licenses`) and `release/version.mjs` (the release plan, read by the Release workflow).
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
- Every user-facing string of the admin lands in `en` and `es` in the same pull request.
- The suites run on the clean Strapi of `test/strapi/app/`: Strapi's defaults and no other plugin. What the distribution adds (security middlewares, CSP, uploads provider) is never added there; the host check (#7) is what verifies it.
- Before 1.0.0 a breaking change raises `y` and everything else raises `z` (section 7). The bump is made by a `chore(release)` pull request before the tag.
