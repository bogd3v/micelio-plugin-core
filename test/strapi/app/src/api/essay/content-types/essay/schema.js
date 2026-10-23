// A fixture type with the editorial workflow in several locales, made with the plugin's helpers.
const { withEditorial, withSiteScope } = require('../../../../../micelio.js')

module.exports = withSiteScope(
  withEditorial({
    kind: 'collectionType',
    collectionName: 'essays',
    info: { singularName: 'essay', pluralName: 'essays', displayName: 'Essay' },
    pluginOptions: { i18n: { localized: true } },
    attributes: {
      title: { type: 'string', required: true, pluginOptions: { i18n: { localized: true } } },
    },
  })
)
