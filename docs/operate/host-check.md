# Host check

A plugin cannot set its host's middlewares, Content Security Policy, uploads provider, database or Node version: those belong to the Strapi project that installs it ([ADR-0017](https://github.com/bogd3v/micelio/blob/main/docs/adr/0017-distribution-plugins-multisite-editorial.md), sections 3 and 7). The plugin verifies them instead. This page is the reference of what it checks and how to fix a failure.

## When it runs

- **At boot**, in the plugin's `bootstrap`, after the default site exists. In production (`NODE_ENV=production`) a failed required check stops the boot, and the error names each failed check and its fix. In any other environment every failure is logged as a warning and Strapi starts. An optional check never stops the boot.
- **On demand**, with `npx micelio doctor` in the Strapi project's folder. It loads the project as `strapi console` does (the boot steps run against the configured database, the server does not start), prints every check with `pass`, `fail` or `skip`, and exits with `1` when a required check fails, `0` otherwise. It reads the same environment as the boot, so run it with the production variables to check production.
- **From the admin**, with **Run again** on the status page ([status-page.md](status-page.md)). It runs the checks against the running Strapi and shows the report; it logs nothing and stops nothing.

Strapi's own CLI cannot be extended by a plugin, so the command is the package's `micelio` binary, not `strapi micelio:doctor`.

```text
$ npx micelio doctor
pass  node: Node 24.18.0
fail  database: The database client is sqlite. Fix: Set the client of config/database to postgres.
pass  security-middlewares: strapi::errors, strapi::security, strapi::cors
…
Host check (production): a required check fails.
```

`skip` means the check does not apply: PostgreSQL outside production, or the checks of the sites' frontends when no site has a `url`. Messages never print a secret: providers by name only, frontends by origin only.

## The checks

| Id                        | Required | Passes when                                                                                                                    | Fix                                                                                                                                                                           |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node`                    | Yes      | The running Node satisfies the plugin's `engines.node`                                                                         | Run a Node version inside that range                                                                                                                                          |
| `database`                | Yes      | The database client is `postgres`; skipped outside production                                                                  | Set `connection.client` in `config/database` to `postgres`                                                                                                                    |
| `security-middlewares`    | Yes      | `config/middlewares` holds `strapi::errors`, `strapi::security` and `strapi::cors`                                             | Add the missing ones                                                                                                                                                          |
| `content-security-policy` | Yes      | `strapi::security` sets a CSP: its `contentSecurityPolicy` is not `false`                                                      | Keep `strapi::security` and do not turn its CSP off                                                                                                                           |
| `html-sanitiser`          | Yes      | `sanitize-html` or `isomorphic-dompurify` loads from the project and strips a `<script>` and an `onerror` from a probe         | Install `sanitize-html` in the project                                                                                                                                        |
| `upload-provider`         | Yes      | The upload plugin has a provider loaded that can upload and delete                                                             | Enable the upload plugin and set its `provider` in `config/plugins`                                                                                                           |
| `frontend-release-line`   | No       | Each site's frontend that answers reports a version of the plugin's release line or the previous minor (standard, section 7)   | Upgrade the frontend to the release line in the plugin's `package.json` (`micelio`)                                                                                           |
| `preview-frame-src`       | No       | The admin's `frame-src` (or `child-src`, or `default-src`) allows the origin of each site's `url`, for the preview of ADR-0019 | Add the origins to `frame-src` in the `strapi::security` config ([ADR-0019](https://github.com/bogd3v/micelio/blob/main/docs/adr/0019-visual-editing-protocol.md), section 5) |

## What the frontend check asks

For each distinct origin of the sites' `url`, the check sends `GET <origin>/_health` with `Accept: application/json` and waits at most two seconds. An answer outside `2xx`, a timeout or a refused connection counts as not reachable, and the check skips that frontend. A `2xx` answer whose JSON body has a `version` string (`{ "version": "0.6.3" }`) is compared with the plugin's release line; any other `2xx` answer is reachable with no version to compare. At boot the frontend is usually not up yet, so the result that matters is a later run: `micelio doctor`, or **Run again** on the status page.

## For other plugins

`strapi.plugin('micelio').service('hostCheck')` runs the same checks: `run()` answers a fresh report, `latest()` the last one (the boot's unless something ran it since). The report's shape is the exported type `HostCheckReport`; each result's `id` is stable, and a reader branches or translates by it, never by its `detail`.
