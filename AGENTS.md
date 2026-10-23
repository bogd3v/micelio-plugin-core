# AGENTS.md

Instructions for coding agents working in this repository. Micelio's core as a Strapi 5 plugin: sites, blocks, the editorial workflow, hooks and the host check.

## Engineering standard

The rules shared by every Micelio repository live in [`docs/engineering-standard.md`](docs/engineering-standard.md). This repository follows standard version 1.5 (`standard: 1.5`; `npm run lint:standard` checks the copy against the hashes bundled in `@micelio/eslint-config`). This file adds what is specific to this repository and never relaxes the standard. The copy is kept in step by the Micelio bot's `docs(standard): sync to X.Y` pull requests: review and merge them, do not edit the file by hand.

## Commands

```bash
npm ci
npm run check            # typecheck, lint, format:check, test, lint:licenses and lint:standard
npm run build            # compiles src/ to dist/
```

## Structure

- `src/` — the code; `test/` — its tests.
- `scripts/` — `check-licenses.mjs` (`npm run lint:licenses`) and `release/version.mjs` (the release plan, read by the Release workflow).
- `.github/workflows/` — `ci.yml`, `release.yml` and `pr-labels.yml`; CI calls the reusable workflows of `micelio-engineering`.

## Rules

- Hard limits: `.claude/TEAM.md`. Never push, merge, tag, release or deploy without the human's approval, and never read secrets.
- Before 1.0.0 a breaking change raises `y` and everything else raises `z` (section 7). The bump is made by a `chore(release)` pull request before the tag.
