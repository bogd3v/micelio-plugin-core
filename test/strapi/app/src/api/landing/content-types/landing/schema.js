// A fixture type for the cost meter: a page made of sections like `page`, site-scoped and editorial, so
// publishing it is a transition and the frontend measures it against its budget. `page` stays a plain
// draft-and-publish type, which other suites publish directly. Like the others it adds nothing of the
// distribution.
const { withEditorial, withSiteScope } = require('../../../../../micelio.js')

const localized = { i18n: { localized: true } }

module.exports = withSiteScope(
  withEditorial({
    kind: 'collectionType',
    collectionName: 'landings',
    info: { singularName: 'landing', pluralName: 'landings', displayName: 'Landing' },
    pluginOptions: { i18n: { localized: true } },
    attributes: {
      title: { type: 'string', required: true, pluginOptions: localized },
      sections: {
        type: 'dynamiczone',
        components: ['section.rich-text', 'section.scene'],
        pluginOptions: localized,
      },
    },
  })
)
