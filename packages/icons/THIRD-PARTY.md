# Third-party material

`@micelio/icons` is under `AGPL-3.0-only` for its own code (the normaliser, the index and the search, [`LICENSES/AGPL-3.0-only.txt`](LICENSES/AGPL-3.0-only.txt)). **The glyphs are not that work**: they are Tabler Icons, which keep their license.

## Tabler Icons

- **Version:** 3.51.0 (pinned in `contract/icons.ts` of `@micelio/strapi-plugin-core`, and the exact version of the `@tabler/icons` dev dependency of this package).
- **Source:** <https://github.com/tabler/tabler-icons>
- **License:** MIT, Copyright (c) 2020-2026 Paweł Kuna. The full text, with the copyright notice, is [`NOTICE`](NOTICE); the SPDX text is [`LICENSES/MIT.txt`](LICENSES/MIT.txt).
- **What ships:** the files of `glyphs/` are Tabler's SVG files, modified by the normaliser (`scripts/normalise.ts`): `viewBox`, no size, class, id, style or colour literal, stroke or fill by `currentColor`. They stay MIT with the same notice. `index.json` is made from Tabler's `icons.json` (names, categories and tags) and is `AGPL-3.0-only AND MIT`.
- **Spanish labels** (`labels/es.json`) are Micelio's own.
