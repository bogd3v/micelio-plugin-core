// A fixture type the `article` fixture points at (docker/cms/src/api/article/): the name and avatar
// the frontend asks for, site-scoped with the plugin's helper.
const { withSiteScope } = require('../../../../../micelio.js')

module.exports = withSiteScope({
  kind: 'collectionType',
  collectionName: 'authors',
  info: { singularName: 'author', pluralName: 'authors', displayName: 'Author' },
  options: { draftAndPublish: false },
  attributes: {
    name: { type: 'string', required: true },
    avatar: { type: 'media', multiple: false, allowedTypes: ['images'] },
  },
})
