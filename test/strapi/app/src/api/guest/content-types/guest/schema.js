// A fixture type for the export suite: personal as a whole, written only with `personal`.
const { withSiteScope } = require('../../../../../micelio.js')

module.exports = withSiteScope({
  kind: 'collectionType',
  collectionName: 'guests',
  info: { singularName: 'guest', pluralName: 'guests', displayName: 'Guest' },
  options: { draftAndPublish: false },
  pluginOptions: { micelio: { export: 'personal' } },
  attributes: {
    email: { type: 'email', required: true },
  },
})
