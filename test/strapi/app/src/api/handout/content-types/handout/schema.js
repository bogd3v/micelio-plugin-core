// A fixture type for the SEO suite (issue #223): a page like the `page` of micelio-cms, site-scoped and
// made with `withPageSettings`, with a `seo` component and a `sections` zone, but without `withEditorial`:
// it is published straight from `create` with `status: 'published'` or from `publish`, the way micelio-cms's
// page is. Like the others it adds nothing of the distribution, and it is left out of the archive
// (`export: never`).
const { withPageSettings, withSiteScope } = require('../../../../../micelio.js')

const localized = { i18n: { localized: true } }

module.exports = withSiteScope(
  withPageSettings({
    kind: 'collectionType',
    collectionName: 'handouts',
    info: { singularName: 'handout', pluralName: 'handouts', displayName: 'Handout' },
    options: { draftAndPublish: true },
    pluginOptions: { i18n: { localized: true }, micelio: { export: 'never' } },
    attributes: {
      title: { type: 'string', required: true, pluginOptions: localized },
      slug: {
        type: 'uid',
        targetField: 'title',
        required: true,
        regex: '^(?!\\.{1,2}$)[A-Za-z0-9-_.~]*$',
        pluginOptions: localized,
      },
      seo: {
        type: 'component',
        repeatable: false,
        component: 'shared.seo',
        pluginOptions: localized,
      },
      sections: {
        type: 'dynamiczone',
        components: ['section.hero', 'section.rich-text'],
        pluginOptions: localized,
      },
    },
  })
)
