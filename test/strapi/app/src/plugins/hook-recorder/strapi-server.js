// A fixture plugin that subscribes to every hook of the core, as another Micelio plugin would
// (docs/hooks.md), and records what it receives in its `recorder` service. It is declared before
// `micelio` in config/plugins.js, so its `register` runs first and uses the `hooks` service.
const HOOKS = [
  'beforeTransition',
  'afterTransition',
  'afterPublish',
  'afterUnpublish',
  'siteCreated',
  'blockCatalogueChanged',
]

module.exports = {
  register({ strapi }) {
    const recorder = strapi.plugin('hook-recorder').service('recorder')
    const hooks = strapi.plugin('micelio').service('hooks')
    for (const hook of HOOKS) {
      hooks.on(hook, (payload) => {
        recorder.calls.push({ hook, payload })
      })
    }
  },
  services: {
    recorder: () => ({ calls: [] }),
  },
}
