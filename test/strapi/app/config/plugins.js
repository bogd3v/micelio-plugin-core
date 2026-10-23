const path = require('node:path')

// The plugin as a host installs it: Strapi reads the repository's package.json and loads the
// built `./strapi-server` export, so the suites run `npm run build` first (test/global-setup.ts).
module.exports = {
  micelio: {
    enabled: true,
    resolve: path.resolve(__dirname, '../../../..'),
    // Every second instead of every minute, so the scheduler suite waits seconds, not a minute.
    config: { scheduledPublishRule: '* * * * * *' },
  },
}
