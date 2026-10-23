# Micelio Plugin Core

`@micelio/strapi-plugin-core` is Micelio's core as a Strapi 5 plugin. It will hold what a Micelio site needs from its CMS: several sites per CMS, the block catalogue, the editorial workflow, the hooks other Micelio plugins build on, and a host check that refuses to start in production when the host is missing what Micelio needs ([ADR-0017](https://github.com/bogd3v/micelio/blob/main/docs/adr/0017-distribution-plugins-multisite-editorial.md)).

It is at `0.1.0` and alpha: it holds the `site` type (one row per site, with a default site created on an empty instance), site scoping for content types, the editorial workflow, the block catalogue ([docs/blocks.md](docs/blocks.md)), the [hooks](docs/hooks.md) other plugins subscribe to, the host check (`npx micelio doctor`, [docs/operate/host-check.md](docs/operate/host-check.md)), the site export and import (`npx micelio export` and `import`, [docs/operate/export.md](docs/operate/export.md)) and the status page in the admin (the **Micelio** entry of its menu, [docs/operate/status-page.md](docs/operate/status-page.md)), and the other capabilities arrive with the issues of the first milestone. Until then, install nothing from it on a site.

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
    },
  },
}
```

## Releases

The Release workflow (`.github/workflows/release.yml`) is started by the maintainer from the Actions tab. It defaults to a dry run that prints the version and the notes. Publishing needs a `release` environment with required reviewers (Settings → Environments), and a pull request title with a conventional prefix decides the version (section 7 of the standard).

## License

[AGPL-3.0-only](LICENSE). Third-party material is listed in [THIRD-PARTY.md](THIRD-PARTY.md).
