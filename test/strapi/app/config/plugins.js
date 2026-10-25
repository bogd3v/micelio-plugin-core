const path = require('node:path')

// The plugin as a host installs it: Strapi reads the repository's package.json and loads the
// built `./strapi-server` export, so the suites run `npm run build` first (test/global-setup.ts).
module.exports = {
  // A fixture plugin that subscribes to the hooks. Declared first: Strapi registers plugins in
  // this order, and a subscriber must not depend on running after the core (docs/hooks.md).
  'hook-recorder': {
    enabled: true,
    resolve: './src/plugins/hook-recorder',
  },
  // A fixture plugin that registers one of each extension point. Declared first for the same
  // reason: its `register` uses the core's `extensions` service.
  'extension-fixture': {
    enabled: true,
    resolve: './src/plugins/extension-fixture',
  },
  micelio: {
    enabled: true,
    resolve: path.resolve(__dirname, '../../../..'),
    // Every second instead of every minute, so the scheduler suite waits seconds, not a minute.
    config: { scheduledPublishRule: '* * * * * *' },
  },
}
