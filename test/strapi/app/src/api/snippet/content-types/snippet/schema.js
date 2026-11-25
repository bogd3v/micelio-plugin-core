// A fixture type for the `code` block suite: a site-scoped page whose zone holds `shared.code`. Like
// the other fixtures it adds nothing of the distribution, and it is left out of the archive
// (`export: never`); the import suite of the block turns that off for its own run.
const { withSiteScope } = require('../../../../../micelio.js')

module.exports = withSiteScope({
  kind: 'collectionType',
  collectionName: 'snippets',
  info: { singularName: 'snippet', pluralName: 'snippets', displayName: 'Snippet' },
  options: { draftAndPublish: true },
  pluginOptions: { micelio: { export: 'never' } },
  attributes: {
    title: { type: 'string', required: true },
    blocks: {
      type: 'dynamiczone',
      components: ['shared.code'],
    },
  },
})
