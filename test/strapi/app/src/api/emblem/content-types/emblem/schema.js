// A fixture type for the `micelio.icon` field: a page made of sections like `landing`, site-scoped
// and editorial, with an icon of its own, an icon in a component and a block that holds one, so the
// save validation and the builder's picker have a field of each kind. Like the others it adds
// nothing of the distribution, and it is left out of the archive (`export: never`).
const { withEditorial, withSiteScope } = require('../../../../../micelio.js')

const localized = { i18n: { localized: true } }

module.exports = withSiteScope(
  withEditorial({
    kind: 'collectionType',
    collectionName: 'emblems',
    info: { singularName: 'emblem', pluralName: 'emblems', displayName: 'Emblem' },
    pluginOptions: { i18n: { localized: true }, micelio: { export: 'never' } },
    attributes: {
      title: { type: 'string', required: true, pluginOptions: localized },
      icon: {
        type: 'customField',
        customField: 'plugin::micelio.icon',
        pluginOptions: localized,
      },
      badge: {
        type: 'component',
        component: 'fixture.icon-card',
        repeatable: false,
        pluginOptions: localized,
      },
      sections: {
        type: 'dynamiczone',
        components: ['section.rich-text', 'fixture.icon-card'],
        pluginOptions: localized,
      },
    },
  })
)
