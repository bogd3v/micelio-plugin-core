// A fixture type for the SEO suites (issue #53): editorial and site-scoped, with a `seo` component but
// made without `withPageSettings`, so its SEO fields are neither derived nor checked before review. Like
// the others it adds nothing of the distribution, and it is left out of the archive (`export: never`).
const { withEditorial, withSiteScope } = require('../../../../../micelio.js')

const localized = { i18n: { localized: true } }

module.exports = withSiteScope(
  withEditorial({
    kind: 'collectionType',
    collectionName: 'flyers',
    info: { singularName: 'flyer', pluralName: 'flyers', displayName: 'Flyer' },
    pluginOptions: { i18n: { localized: true }, micelio: { export: 'never' } },
    attributes: {
      title: { type: 'string', required: true, pluginOptions: localized },
      seo: {
        type: 'component',
        repeatable: false,
        component: 'shared.seo',
        pluginOptions: localized,
      },
    },
  })
)
