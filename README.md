# Micelio Plugin Core

`@micelio/strapi-plugin-core` is Micelio's core as a Strapi 5 plugin. It will hold what a Micelio site needs from its CMS: several sites per CMS, the block catalogue, the editorial workflow, the hooks other Micelio plugins build on, and a host check that refuses to start in production when the host is missing what Micelio needs ([ADR-0017](https://github.com/bogd3v/micelio/blob/main/docs/adr/0017-distribution-plugins-multisite-editorial.md)).

It is at `0.2.0` and alpha: it holds the `site` type (one row per site, with a default site created on an empty instance), site scoping for content types, the editorial workflow, the block catalogue ([docs/blocks.md](docs/blocks.md)), the [hooks](docs/hooks.md) other plugins subscribe to, the host check (`npx micelio doctor`, [docs/operate/host-check.md](docs/operate/host-check.md)), the site export and import (`npx micelio export` and `import`, [docs/operate/export.md](docs/operate/export.md)), the status page in the admin (the **Micelio** entry of its menu, [docs/operate/status-page.md](docs/operate/status-page.md)), the preview of drafts on the frontend ([docs/operate/preview.md](docs/operate/preview.md)) and the `category` and `tag` types, and the other capabilities arrive with the issues of the first milestone. Until then, install nothing from it on a site.

## Plugin or distribution

[`micelio-cms`](https://github.com/bogd3v/micelio-cms) is the **reference distribution**: a Strapi project with the plugins installed and the configuration a plugin cannot set for its host (security middlewares, CSP, uploads provider, database, image and Compose files). It is what hosting runs and what "Micelio 0.6" means. Use it to run a Micelio site. The plugin is for a developer who already runs Strapi and wants Micelio in it.

`micelio` in `package.json` names the release line of Micelio this version supports (`0.6`).

## Getting started

```bash
npm ci
npm run check
```

`npm run check` builds the plugin, boots a clean Strapi 5 on SQLite with it installed, and checks that it registers. Conventions, commands and structure are in [AGENTS.md](AGENTS.md); the rules every Micelio repository shares are in the [engineering standard](docs/engineering-standard.md). To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md).

## Configuration

The plugin reads its options from the host's `config/plugins`:

```js
module.exports = {
  micelio: {
    config: {
      // When the scheduler publishes the scheduled entries that are due, as a cron rule.
      // `false` turns it off: scheduled entries then wait for `transitions.publishDue()`.
      scheduledPublishRule: '* * * * *', // the default: every minute
      // When the host check and the checks of other plugins run again on their own, as a cron rule.
      // `false` turns it off: they then run only with "Run again" in the status page.
      statusRefreshRule: '0 4 * * *', // the default: every day at 04:00 server time
      // The weight, in kB, above which publishing a page with blocks is refused (docs/operate/budgets.md).
      // A key replaces the default of that page type; `sites` sets a site's own, by its slug.
      // `contentTypes` lists the types measured at publish, the ones the frontend previews.
      budgets: {
        contentTypes: ['api::page.page', 'api::article.article'], // the default
        pageTypes: { landing: 60, standard: 120, 'long-read': 160 }, // the defaults
        sites: {},
      },
    },
  },
}
```

## Releases

The Release workflow (`.github/workflows/release.yml`) is started by the maintainer from the Actions tab. It defaults to a dry run that prints the version and the notes and names the package it would publish (`@micelio/strapi-plugin-core`), and changes nothing. A pull request title with a conventional prefix decides the version (section 7 of the standard). Publishing needs a `release` environment (Settings → Environments) with the maintainer as required reviewer and deployments limited to `main`, which gate the publish job, and the `NPM_TOKEN` secret of an npm account that can publish under `@micelio`. `NPM_TOKEN` is a repository secret, not a secret of the environment: the plan job checks that it is passed before the approval and cannot see an environment secret. Set it with `gh secret set NPM_TOKEN -R bogd3v/micelio-plugin-core`.

The first release is `v0.1.0`, the `version` in `package.json`: with no earlier tag there is no bump, so no `chore(release)` pull request comes before it. To cut it:

1. Run the workflow on `main` with `dry_run` on (the default) and `compatibility` filled in, and read the plan: tag `v0.1.0`, the notes, `npm: would publish @micelio/strapi-plugin-core`.
2. Run it again with `dry_run` off and the same `compatibility`. The publish job waits for the maintainer's approval in the `release` environment, then publishes to npm with provenance and creates the tag and the GitHub release with an SBOM.
3. Check it: `npm view @micelio/strapi-plugin-core@0.1.0` answers. Then verify the provenance in an empty project, not in this repository (`npm audit signatures` checks the dependencies of the project it runs in, and this package is not one of its own):

   ```bash
   mkdir verify-core && cd verify-core && npm init -y
   npm install @micelio/strapi-plugin-core@0.1.0
   npm audit signatures
   ```

   The output says the package has a verified registry signature and a verified attestation.

`compatibility` is required to publish. Every release states the release line of the core it supports (`micelio` in `package.json`) and the minimum Node (`engines`):

```
- Micelio release line: 0.6
- Node: 22.19 or later
```

When a pull request since the last release is breaking (a `!` in its title), the workflow refuses to publish unless both `breaking_changes` (the hand-written "Breaking changes" section: who is affected) and `upgrade_notes` (what to do) are set; a dry run only warns. Both are Markdown and go in the release body.

A release candidate (`release_candidate`) is published under the `next` tag and moves neither `X.Y` nor `latest`.

## License

[AGPL-3.0-only](LICENSE). Third-party material is listed in [THIRD-PARTY.md](THIRD-PARTY.md).
