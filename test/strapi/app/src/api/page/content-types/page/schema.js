// A fixture type for the preview: a page made of sections, with the shape of the `page` of micelio-cms
// (the frontend previews `api::page.page`), site-scoped with the plugin's helper. Like the others it
// adds nothing of the distribution. `section.reusable` references a reusable block as #201 shapes it.
// Only the suite of a reusable block's publish (test/strapi/reusable-block-budget.test.ts) makes it
// editorial (`MICELIO_TEST_EDITORIAL_PAGE`), so its publish goes through the transitions and the budget
// measures it; every other suite publishes it with the document service.
const { withEditorial, withSiteScope } = require('../../../../../micelio.js')

const localized = { i18n: { localized: true } }

const page = {
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
        'section.rich-text',
        'section.scene',
        'section.feature-grid',
        'section.gallery',
        'section.reusable',
        'shared.rich-text',
      ],
      pluginOptions: localized,
    },
  },
}

module.exports = withSiteScope(
  process.env.MICELIO_TEST_EDITORIAL_PAGE === 'true' ? withEditorial(page) : page
)
