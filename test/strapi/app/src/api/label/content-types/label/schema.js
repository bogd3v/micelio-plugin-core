// A fixture type for the export suite: localised, and the inverse side of `story.labels`.
const { withSiteScope } = require('../../../../../micelio.js')

module.exports = withSiteScope({
  kind: 'collectionType',
  collectionName: 'labels',
  info: { singularName: 'label', pluralName: 'labels', displayName: 'Label' },
  options: { draftAndPublish: false },
  pluginOptions: { i18n: { localized: true } },
  attributes: {
    name: { type: 'string', required: true, pluginOptions: { i18n: { localized: true } } },
    stories: {
      type: 'relation',
      relation: 'manyToMany',
      target: 'api::story.story',
      mappedBy: 'labels',
    },
  },
})
