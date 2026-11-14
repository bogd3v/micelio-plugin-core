# Icons

An icon is a **name** of one set, [Tabler Icons](https://tabler.io/icons), at the version the block contract pins (ADR-0021 of `micelio`). A block stores `map-pin`, never a file. This page is how the set is pinned, raised and aliased, and how a Spanish label is added. What a theme may redraw and the sprite are other issues of the same plan; the field and the picker that store and choose a name are [the custom field `micelio.icon`](#the-custom-field).

## What lives where

| What                                                                        | Where                                                       | Shipped as                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| The pin: `{ set: 'tabler', version, names, aliases }`, written with zod     | `contract/icons.ts`                                         | Source; `@micelio/strapi-plugin-core/icons.schema.json` |
| Every pinned name (generated)                                               | `contract/icons.names.json`                                 | Read by `contract/icons.ts`                             |
| Its JSON Schema (generated): a name is one of the pinned ones               | `contract/icons.schema.json`                                | `@micelio/strapi-plugin-core/icons.schema.json`         |
| The index (generated): per name, English label, category, aliases, `filled` | `packages/icons/index.json`                                 | `@micelio/icons/index.json`                             |
| The Spanish labels                                                          | `packages/icons/labels/es.json`                             | `@micelio/icons`                                        |
| The names that must have one                                                | `packages/icons/labels/core-names.ts`                       | Not shipped                                             |
| The normaliser                                                              | `packages/icons/scripts/normalise.ts`                       | Not shipped                                             |
| The glyphs: `glyphs/outline/<name>.svg` and `glyphs/filled/<name>.svg`      | Written by `npm run build -w @micelio/icons`, not committed | `@micelio/icons/glyphs/*`                               |

`@micelio/icons` is a workspace of this repository (`packages/icons/`, version `0.1.1`, `AGPL-3.0-only AND MIT`); the plugin stays at the root. The set comes from the `@tabler/icons` dev dependency of the package, at an exact version, and from nowhere else: nothing is loaded from a CDN or an icon API, at build or at run time.

## A glyph

`packages/icons/scripts/normalise.ts` turns a Tabler file into the glyph the package ships (ADR-0021, section 2): `viewBox="0 0 24 24"`, no `width`, `height`, `class`, `id`, `style` or colour literal, no `stroke-width` (the theme sets it in CSS; Tabler draws at `2`), and the bounding-box path Tabler puts first, which paints nothing, dropped. The outline root is `fill="none" stroke="currentColor"` with round caps and joins; the filled alternate Tabler ships for about a thousand names is `fill="currentColor"`. A file with an element the normaliser does not know, or another `viewBox`, fails the build instead of shipping.

`import { readGlyph } from '@micelio/icons'` reads one glyph from disk when it is asked for; `style: 'filled'` falls back to the outline for a name that has no filled alternate, and a name that is an alias answers the glyph it points to. Each read names its file inline (`new URL('../index.json', import.meta.url)`, the same for `labels/es.json`, and a template literal for the glyph), because a file tracer follows only that shape: a server build that traces `dist/index.js` (Nitro, with `@vercel/nft`) copies `index.json`, `labels/es.json` and every glyph under `glyphs/` next to the package, and `test/package.test.ts` checks it.

## The index and the search

`index.json` lists every name with its English label (the name in sentence case: `map-pin` is `Map pin`), Tabler's category, its aliases (Tabler's tags, and the names it replaced) and whether a filled glyph exists. The core reads the index, the Spanish labels and the glyphs from `@micelio/icons` at run time (a dependency of the plugin). `searchIcons` matches every word of a query against the name, both labels, both category names and the aliases, ignoring case and accents; an exact name comes first.

## The custom field

The plugin registers the custom field `micelio.icon` (`plugin::micelio.icon`, a string) on the server (`server/src/icons/register.ts`) and in the admin (`admin/src/index.ts`, the input is `admin/src/components/IconField.tsx`). A host or a distribution puts it in a schema as `{ "type": "customField", "customField": "plugin::micelio.icon" }`, in a type, a component or a block. The editor's side is [Picking an icon](guide/icons.md).

- **What it stores**: the name as the editor picked it, or `null` for none. It is never rewritten: an alias stays stored as it is and renders the glyph it points to.
- **The check at save**: the document service middleware `server/src/icons/documents.ts` refuses, on `create`, `update` and `clone`, a value that is not a name of `contract/icons.ts` or one of its aliases (`iconInvalid`, `docs/api.md`, "Errors"). The names it checks against are `strapi.plugin('micelio').service('icons').catalogue`, a copy of the pin.
- **The route**: `GET /micelio/icons?site=` (`docs/api.md`, "Icons") answers the entries of the sprite a site resolves, read from `@micelio/icons` (the plugin depends on it: `index.json`, the Spanish labels and the glyphs). `sourceOf` in `server/src/icons/read.ts` is where a theme's own glyph will win over the core's in step 2; in step 1 every entry is the core's.

## Pin, raise, alias

1. Raise the version in two places, exactly: `TABLER_VERSION` in `contract/icons.ts` and the `@tabler/icons` dev dependency of `packages/icons/package.json` (and the version in `packages/icons/THIRD-PARTY.md` and `THIRD-PARTY.md`). `npm run lint:icons` fails when the contract and the installed set differ.
2. Run `npm run icons:generate`: it writes the names, the schema and the index. Run `npm run build -w @micelio/icons` to see the glyphs normalise (a new shape fails there).
3. A name Tabler renamed or removed stays: add `old-name: 'new-name'` to `ICON_ALIASES` in `contract/icons.ts` before generating. The alias must not be a name and must point to one (`IconCatalogue` checks both), and the index lists it as an alias of the new name.
4. Versions (ADR-0021, section 6): a raise that only adds names is a MINOR of the block contract; a rename with its alias is not breaking; dropping an alias is a MAJOR. `@micelio/icons` has its own version, raised in the pull request that changes the package, and published by hand (next section).

`npm run lint:icons` (part of `npm run lint`) fails when `contract/icons.names.json`, `contract/icons.schema.json` or `packages/icons/index.json` drifts from `contract/icons.ts` and the installed set.

## Releasing the package

The Release workflow publishes the plugin only: `.github/workflows/release.yml` lists no workspace, because the reusable workflow of `micelio-engineering` fails on a version that is already on npm, which would stop every plugin release after the first. So `@micelio/icons` is published by the maintainer, by hand, whenever its `version` is raised (the first time, `0.1.0`): from a clean checkout of `main`, `npm ci`, then `npm publish -w @micelio/icons --access public --provenance=false` (`prepack` builds the glyphs, `NOTICE` and `LICENSES/`). The package's `publishConfig` asks for provenance, which npm signs only from a CI run, so a hand publish has none and says so in its release notes. Its SBOM is made by hand too, the way the Release workflow makes the plugin's: `npm sbom --sbom-format spdx -w @micelio/icons > sbom-icons.spdx.json`, attached to a GitHub release of its own, tagged `icons-v<version>` so that it never collides with the plugin's `v<version>` tags (`gh release create icons-v0.1.0 sbom-icons.spdx.json --target main --title "@micelio/icons 0.1.0" --notes "Published by hand: no provenance."`, from the commit that was published; "Releases" in `README.md` describes the plugin's, which the workflow attaches). Provenance and the SBOM come back with the follow-up. **Order.** The plugin depends on `@micelio/icons` at run time, so `@micelio/icons@<version>` is published before the plugin release whose `dependencies` name it: a plugin published first cannot be installed. npm's staged publishing holds a first publish until the maintainer approves it on npmjs.com (a placeholder `0.0.0-stage` appears meanwhile); wait for the approval and check `npm view @micelio/icons version` before tagging the plugin. Making the reusable workflow skip a workspace version already published is a follow-up in `micelio-engineering`.

## A Spanish label

Tabler ships English names, tags and categories only, so the index carries Spanish labels for **every category** and for **the names the core uses** (its defaults and the names the four step-1 fields suggest first), and every other name answers its English label in Spanish (maintainer's decision of 2026-11-12). The search matches both labels.

To add one, put the name in `packages/icons/labels/core-names.ts` (the group of the block that uses it) and its label under `names` in `packages/icons/labels/es.json`; a category goes under `categories`. `packages/icons/test/labels.test.ts` fails when a category or a core name has no Spanish label, and when a label belongs to a name that is not in the set.

## Licence

Tabler Icons is MIT, Copyright (c) 2020-2026 Paweł Kuna. The package carries Tabler's `LICENSE` as `NOTICE` (written by the build from the pinned set) next to `LICENSES/MIT.txt`, lists Tabler and its version in `THIRD-PARTY.md`, and the glyph files and the notice are annotated as MIT in `REUSE.toml`. The normaliser's output is a modification of Tabler's files and stays MIT with the same notice; the package's own code is under the repository's licence.
