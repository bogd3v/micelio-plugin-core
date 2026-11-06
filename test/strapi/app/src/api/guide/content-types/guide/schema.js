// A fixture type for the page settings: a page with a slug and sections like the `page` of micelio-cms,
// site-scoped, editorial and made with `withPageSettings`, so its publish is a transition that
// measures it against the budget of its page type and writes the redirect of a slug that changed. Like
// the others it adds nothing of the distribution. It is left out of the archive (`export: never`): the
// export suites list the types of the test app and compare their archives, which this fixture is not for.
const { withEditorial, withPageSettings, withSiteScope } = require('../../../../../micelio.js')

const localized = { i18n: { localized: true } }

module.exports = withSiteScope(
  withEditorial(
    withPageSettings({
      kind: 'collectionType',
      collectionName: 'guides',
      info: { singularName: 'guide', pluralName: 'guides', displayName: 'Guide' },
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
          components: [
            'section.rich-text',
            'section.scene',
            'section.feature-grid',
            'section.logo-cloud',
            'shared.media',
          ],
          pluginOptions: localized,
        },
      },
    })
  )
)
