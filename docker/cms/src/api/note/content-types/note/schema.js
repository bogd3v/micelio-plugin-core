// A fixture type for trying the preview: made site-scoped with the plugin's helper, as the test app's.
// Its `icon` is the custom field `micelio.icon` (docs/operate/manual-testing.md, "Try the icon field").
const { withSiteScope } = require('../../../../../micelio.js')

module.exports = withSiteScope({
  kind: 'collectionType',
  collectionName: 'notes',
  info: { singularName: 'note', pluralName: 'notes', displayName: 'Note' },
  options: { draftAndPublish: false },
  attributes: {
    title: { type: 'string', required: true },
    icon: { type: 'customField', customField: 'plugin::micelio.icon' },
  },
})
