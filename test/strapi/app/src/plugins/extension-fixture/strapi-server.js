// A fixture plugin that registers one of each extension point of the core, as a sibling plugin
// would (docs/plugins/extension-points.md): an admin page, a site section, two status checks and
// an export section with personal data. It is declared before `micelio` in config/plugins.js, so
// its `register` runs first and uses the `extensions` service.
const READ = 'plugin::extension-fixture.read'
const MANAGE = 'plugin::extension-fixture.manage'

module.exports = {
  register({ strapi }) {
    const extensions = strapi.plugin('micelio').service('extensions')
    const store = strapi.plugin('extension-fixture').service('store')

    extensions.registerAdminPage({
      id: 'fixture-page',
      group: 'site',
      label: { en: 'Fixture page', es: 'Página de prueba' },
      to: 'fixture',
      permission: READ,
    })
    extensions.registerSiteSection({
      id: 'fixture-profile',
      component: 'extension-fixture.profile',
      label: { en: 'Fixture profile', es: 'Perfil de prueba' },
      panel: 'extension-fixture.profile',
      permission: READ,
    })
    extensions.registerStatusChecks({
      id: 'fixture-checks',
      label: { en: 'Fixture checks', es: 'Comprobaciones de prueba' },
      permission: READ,
      run(site) {
        store.runs.push(site.slug)
        return [
          {
            id: 'reachable',
            title: { en: 'The fixture answers', es: 'La prueba responde' },
            status: 'ok',
          },
          {
            id: 'handle',
            title: { en: 'The fixture has a handle', es: 'La prueba tiene un alias' },
            status: 'warn',
            detail: {
              en: `Site ${site.slug} has no handle.`,
              es: `El sitio ${site.slug} no tiene alias.`,
            },
            fix: { en: 'Set a handle.', es: 'Define un alias.' },
          },
        ]
      },
    })
    extensions.registerExportSection({
      id: 'fixture-members',
      version: '1.0',
      personalData: true,
      permission: MANAGE,
      async *write(site) {
        yield {
          path: 'members.json',
          body: JSON.stringify({ site: site.slug, members: store.members }),
        }
      },
      async read(site, entries) {
        store.read.push({ site: site.slug, paths: entries.map((entry) => entry.path) })
        return { imported: entries.length, skipped: 0 }
      },
    })
  },
  async bootstrap({ strapi }) {
    await strapi.service('admin::permission').actionProvider.registerMany([
      {
        section: 'plugins',
        displayName: 'Read the fixture',
        uid: 'read',
        pluginName: 'extension-fixture',
      },
      {
        section: 'plugins',
        displayName: 'Manage the fixture',
        uid: 'manage',
        pluginName: 'extension-fixture',
      },
    ])
  },
  services: {
    store: () => ({ runs: [], members: ['member@example.com'], read: [] }),
  },
}
