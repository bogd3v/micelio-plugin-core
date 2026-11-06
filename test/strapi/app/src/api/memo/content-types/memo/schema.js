// A fixture type for the redirects: editorial and site-scoped with a slug, but not made with
// `withPageSettings`, so a published slug that changes writes no redirect. Like the others it adds
// nothing of the distribution. It is left out of the archive (`export: never`), as the `guide` is.
const { withEditorial, withSiteScope } = require('../../../../../micelio.js')

module.exports = withSiteScope(
  withEditorial({
    kind: 'collectionType',
    collectionName: 'memos',
    info: { singularName: 'memo', pluralName: 'memos', displayName: 'Memo' },
    pluginOptions: { micelio: { export: 'never' } },
    attributes: {
      title: { type: 'string', required: true },
      slug: { type: 'string', required: true },
    },
  })
)
