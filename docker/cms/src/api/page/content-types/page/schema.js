// A fixture type for the preview: a page made of sections, with the shape of the `page` of micelio-cms
// (the frontend previews `api::page.page` and asks the CMS for every section of the catalogue, so the
// zone lists them all; their schemas are written by dev.mjs from the fixture of the catalogue),
// site-scoped and editorial with the plugin's helpers (a page with blocks is measured against its budget
// when it is published). Like the others it adds nothing of the distribution.
const { withEditorial, withSiteScope } = require('../../../../../micelio.js')

const localized = { i18n: { localized: true } }

module.exports = withSiteScope(
  withEditorial({
    kind: 'collectionType',
    collectionName: 'pages',
    info: { singularName: 'page', pluralName: 'pages', displayName: 'Page' },
    options: { draftAndPublish: true },
    pluginOptions: { i18n: { localized: true } },
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
        components: [
          'section.hero',
          'section.feature-grid',
          'section.media-showcase',
          'section.stats',
          'section.logo-cloud',
          'section.testimonials',
          'section.pricing',
          'section.faq',
          'section.cta',
          'section.post-list',
          'section.newsletter',
          'section.rich-text',
          'section.gallery',
          'section.scene',
        ],
        pluginOptions: localized,
      },
    },
  })
)
