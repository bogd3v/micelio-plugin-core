// The plugin as a host installs it: the working tree mounted at /plugin, built by the entrypoint.
module.exports = {
  // The fixture plugin of the suites, to try the extension points by hand (docs/operate/manual-testing.md,
  // "Try the Sites page"). Declared first: its `register` uses the core's `extensions` service.
  'extension-fixture': {
    enabled: true,
    resolve: '/plugin/test/strapi/app/src/plugins/extension-fixture',
  },
  micelio: { enabled: true, resolve: '/plugin' },
}
