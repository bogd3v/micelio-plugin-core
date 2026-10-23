# Third-party material

Micelio Plugin Core's license ([LICENSE](LICENSE), AGPL-3.0-only) covers only the work of Micelio's contributors. **Third-party material is not part of that licensing**: it keeps the license its authors gave it, and whoever reuses it follows that license.

When you add some (code, fonts, images, logos), list it here with its source and license, keep its license file next to it, and annotate its path in [REUSE.toml](REUSE.toml), the machine-readable version of this list (`reuse lint` checks it in CI; the license texts are in `LICENSES/`).

## Strapi's plugin SDK scaffold

The plugin started from the scaffold of `strapi-plugin init` (`@strapi/sdk-plugin` 6.1.1, MIT, Copyright (c) 2015-present Strapi Solutions SAS). Material from it keeps the MIT license and Strapi's copyright notice:

- **Unmodified except for formatting**: `admin/custom.d.ts`, `admin/tsconfig.json`, `admin/tsconfig.build.json`, `admin/src/components/Initializer.tsx`, `server/tsconfig.build.json` and the empty `content-types`, `middlewares` and `policies` indexes of `server/src/`. MIT only.
- **Modified by Micelio**: the other files of `admin/src/` and `server/src/` that the scaffold created (the entry points, the lifecycle phases, the configuration, the route, controller and service indexes) and `server/tsconfig.json`. Strapi's part stays MIT and Micelio's changes are under the AGPL (`AGPL-3.0-only AND MIT` in `REUSE.toml`).

## Dependencies

npm packages (`package.json`, `package-lock.json`) are distributed under their own licenses, which each package carries. `npm run lint:licenses` fails when a production dependency has a license that cannot be combined with AGPL-3.0; the allowlist is the one shipped in `@micelio/eslint-config`.
