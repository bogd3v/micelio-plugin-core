// A fixture type made site-scoped with the plugin's helper, as every Micelio type will be.
const { withSiteScope } = require('../../../../../micelio.js')

module.exports = withSiteScope({
  kind: 'collectionType',
  collectionName: 'notes',
  info: { singularName: 'note', pluralName: 'notes', displayName: 'Note' },
  options: { draftAndPublish: false },
  attributes: {
    title: { type: 'string', required: true },
  },
})
