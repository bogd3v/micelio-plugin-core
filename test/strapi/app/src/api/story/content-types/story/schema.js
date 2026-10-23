// A fixture type for the export suite: localised, editorial, and with one attribute of each kind
// the archive writes or leaves out (docs/export-format.md, "Attributes").
const { withEditorial, withSiteScope } = require('../../../../../micelio.js')

const localized = { i18n: { localized: true } }
const shared = { i18n: { localized: false } }

module.exports = withSiteScope(
  withEditorial({
    kind: 'collectionType',
    collectionName: 'stories',
    info: { singularName: 'story', pluralName: 'stories', displayName: 'Story' },
    pluginOptions: { i18n: { localized: true } },
    attributes: {
      title: { type: 'string', required: true, pluginOptions: localized },
      body: { type: 'richtext', pluginOptions: localized },
      day: { type: 'date', pluginOptions: shared },
      score: { type: 'integer', pluginOptions: shared },
      cover: { type: 'media', multiple: false, allowedTypes: ['images'], pluginOptions: shared },
      gallery: { type: 'media', multiple: true, allowedTypes: ['images'], pluginOptions: shared },
      labels: {
        type: 'relation',
        relation: 'manyToMany',
        target: 'api::label.label',
        inversedBy: 'stories',
      },
      owner: { type: 'relation', relation: 'oneToOne', target: 'admin::user' },
      links: {
        type: 'component',
        repeatable: true,
        component: 'fixture.link',
        pluginOptions: shared,
      },
      blocks: {
        type: 'dynamiczone',
        components: ['shared.quote', 'fixture.link'],
        pluginOptions: localized,
      },
      notes: { type: 'text', private: true, pluginOptions: shared },
      pin: { type: 'password', pluginOptions: shared },
      contact: {
        type: 'email',
        pluginOptions: { ...shared, micelio: { export: 'personal' } },
      },
    },
  })
)
