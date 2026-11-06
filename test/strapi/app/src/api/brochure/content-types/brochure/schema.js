// A fixture type for the review suites (issue #57): a page with a slug like the `page` of micelio-cms,
// site-scoped, editorial and made with `withPageSettings`, whose sections include `section.cta`, a
// block with links. A link to another brochure that is not published is the `linkToDraft` warning.
// Like the others it adds nothing of the distribution, and it is left out of the archive.
const { withEditorial, withPageSettings, withSiteScope } = require('../../../../../micelio.js')

const localized = { i18n: { localized: true } }

module.exports = withSiteScope(
  withEditorial(
    withPageSettings({
      kind: 'collectionType',
      collectionName: 'brochures',
      info: { singularName: 'brochure', pluralName: 'brochures', displayName: 'Brochure' },
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
        sections: {
          type: 'dynamiczone',
          components: ['section.rich-text', 'section.cta', 'section.scene'],
          pluginOptions: localized,
        },
      },
    })
  )
)
