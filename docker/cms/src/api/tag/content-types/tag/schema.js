// A fixture type the `post-list` section of the page fixture points at (docker/cms/src/api/page/):
// only what the frontend asks for, site-scoped with the plugin's helper.
const { withSiteScope } = require('../../../../../micelio.js')

module.exports = withSiteScope({
  kind: 'collectionType',
  collectionName: 'tags',
  info: { singularName: 'tag', pluralName: 'tags', displayName: 'Tag' },
  options: { draftAndPublish: false },
  attributes: {
    name: { type: 'string', required: true },
    slug: { type: 'uid', targetField: 'name', required: true },
  },
})
