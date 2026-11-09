// A fixture type for the SEO suites (issue #53): a page like the `page` of micelio-cms, with its `seo`
// component (`shared.seo`) and a `hero` section, site-scoped, editorial and made with `withPageSettings`.
// The meta fields are derived at save and checked when the page leaves `draft`. Like the others it adds
// nothing of the distribution, and it is left out of the archive (`export: never`).
const { withEditorial, withPageSettings, withSiteScope } = require('../../../../../micelio.js')

const localized = { i18n: { localized: true } }

module.exports = withSiteScope(
  withEditorial(
    withPageSettings({
      kind: 'collectionType',
      collectionName: 'leaflets',
      info: { singularName: 'leaflet', pluralName: 'leaflets', displayName: 'Leaflet' },
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
          components: ['section.hero', 'section.rich-text', 'section.scene'],
          pluginOptions: localized,
        },
      },
    })
  )
)
