// A fixture type for the preview: a page made of sections, with the shape of the `page` of micelio-cms
// (the frontend previews `api::page.page`), site-scoped with the plugin's helper. Like the others it
// adds nothing of the distribution.
const { withSiteScope } = require('../../../../../micelio.js')

const localized = { i18n: { localized: true } }

module.exports = withSiteScope({
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
      components: ['section.rich-text', 'section.scene'],
      pluginOptions: localized,
    },
  },
})
