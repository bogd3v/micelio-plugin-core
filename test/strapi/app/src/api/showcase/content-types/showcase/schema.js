// A fixture type for the islands' suites: the same as `landing` (site-scoped and editorial, a page made
// of sections) with the `playground` block, which is an island of its own kind. `landing` stays as the
// suites that count its blocks expect it. Like the others it adds nothing of the distribution.
const { withEditorial, withSiteScope } = require('../../../../../micelio.js')

const localized = { i18n: { localized: true } }

module.exports = withSiteScope(
  withEditorial({
    kind: 'collectionType',
    collectionName: 'showcases',
    info: { singularName: 'showcase', pluralName: 'showcases', displayName: 'Showcase' },
    // Never exported: the export suites count the site-scoped types of the app, and this one is only
    // the islands' fixture.
    pluginOptions: { i18n: { localized: true }, micelio: { export: 'never' } },
    attributes: {
      title: { type: 'string', required: true, pluginOptions: localized },
      sections: {
        type: 'dynamiczone',
        components: ['section.rich-text', 'section.scene', 'shared.playground'],
        pluginOptions: localized,
      },
    },
  })
)
