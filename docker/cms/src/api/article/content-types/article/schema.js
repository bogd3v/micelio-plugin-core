// A fixture type with the editorial workflow, made with the plugin's helpers, and the shape of the
// `article` of micelio-cms: the frontend asks for every one of these attributes when it previews a
// draft (`ARTICLE_POPULATE` in micelio), and the CMS answers 400 for a key the type does not have.
// The components are written by dev.mjs from the fixture of the catalogue.
const { withEditorial, withSiteScope } = require('../../../../../micelio.js')

const localized = { i18n: { localized: true } }

module.exports = withSiteScope(
  withEditorial({
    kind: 'collectionType',
    collectionName: 'articles',
    info: { singularName: 'article', pluralName: 'articles', displayName: 'Article' },
    pluginOptions: { i18n: { localized: true } },
    attributes: {
      title: { type: 'string', required: true, pluginOptions: localized },
      description: { type: 'text', pluginOptions: localized },
      slug: {
        type: 'uid',
        targetField: 'title',
        regex: '^(?!\\.{1,2}$)[A-Za-z0-9-_.~]*$',
        pluginOptions: localized,
      },
      cover: { type: 'media', multiple: false, allowedTypes: ['images'], pluginOptions: localized },
      coverCredit: {
        type: 'component',
        repeatable: false,
        component: 'shared.image-credit',
        pluginOptions: localized,
      },
      author: { type: 'relation', relation: 'manyToOne', target: 'api::author.author' },
      category: { type: 'relation', relation: 'manyToOne', target: 'api::category.category' },
      tags: { type: 'relation', relation: 'manyToMany', target: 'api::tag.tag' },
      blocks: {
        type: 'dynamiczone',
        components: [
          'shared.media',
          'shared.playground',
          'shared.quote',
          'shared.rich-text',
          'shared.slider',
        ],
        pluginOptions: localized,
      },
      references: {
        type: 'component',
        repeatable: true,
        component: 'shared.reference',
        pluginOptions: { i18n: { localized: false } },
      },
      seo: {
        type: 'component',
        repeatable: false,
        component: 'shared.seo',
        pluginOptions: localized,
      },
    },
  })
)
