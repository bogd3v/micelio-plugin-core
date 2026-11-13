// A fixture type for the block settings suite and the Block catalogue page: a site-scoped page of
// sections whose zone holds `section.newsletter`, the block that needs a module of the site. Other
// fixtures keep their zones, so their suites keep counting the same blocks. Like the others it adds
// nothing of the distribution. It is left out of the archive (`export: never`).
const { withSiteScope } = require('../../../../../micelio.js')

module.exports = withSiteScope({
  kind: 'collectionType',
  collectionName: 'bulletins',
  info: { singularName: 'bulletin', pluralName: 'bulletins', displayName: 'Bulletin' },
  options: { draftAndPublish: true },
  pluginOptions: { micelio: { export: 'never' } },
  attributes: {
    title: { type: 'string', required: true },
    sections: {
      type: 'dynamiczone',
      components: ['section.rich-text', 'section.newsletter'],
    },
  },
})
