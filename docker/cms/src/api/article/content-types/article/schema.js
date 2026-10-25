// A fixture type with the editorial workflow, made with the plugin's helpers.
const { withEditorial, withSiteScope } = require('../../../../../micelio.js')

module.exports = withSiteScope(
  withEditorial({
    kind: 'collectionType',
    collectionName: 'articles',
    info: { singularName: 'article', pluralName: 'articles', displayName: 'Article' },
    attributes: {
      title: { type: 'string', required: true },
    },
  })
)
