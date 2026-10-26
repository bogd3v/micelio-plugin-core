const path = require('node:path')

// The plugin as a host installs it: Strapi reads the repository's package.json and loads the
// built `./strapi-server` export, so the suites run `npm run build` first (test/global-setup.ts).
module.exports = ({ env }) => ({
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
  // Only the suite of the takeover of category and tag turns it on (`MICELIO_TEST_USERS_PERMISSIONS`):
  // a database written by micelio-cms holds the public role's grants of the two types. Every other
  // suite runs on a Strapi with this plugin alone, as a host without users-permissions has it.
  ...(env.bool('MICELIO_TEST_USERS_PERMISSIONS', false) && {
    'users-permissions': {
      enabled: true,
      resolve: path.dirname(require.resolve('@strapi/plugin-users-permissions/package.json')),
    },
  }),
})
