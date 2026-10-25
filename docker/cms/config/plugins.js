// The plugin as a host installs it: the working tree mounted at /plugin, built by the entrypoint.
module.exports = {
  micelio: { enabled: true, resolve: '/plugin' },
}
