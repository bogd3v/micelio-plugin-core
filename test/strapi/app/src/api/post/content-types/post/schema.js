// A fixture type for the draft read of the preview: the shape of the `article` of micelio-cms,
// which the frontend asks for with `populate` (media, a component, a dynamic zone and relations,
// one of them to another entry of its own type). Site-scoped with the plugin's helper; like the
// others it adds nothing of the distribution.
const { withSiteScope } = require('../../../../../micelio.js')

module.exports = withSiteScope({
  kind: 'collectionType',
  collectionName: 'posts',
  info: { singularName: 'post', pluralName: 'posts', displayName: 'Post' },
  options: { draftAndPublish: true },
  attributes: {
    title: { type: 'string', required: true },
    cover: { type: 'media', multiple: false, allowedTypes: ['images'] },
    seo: { type: 'component', repeatable: false, component: 'shared.seo' },
    blocks: { type: 'dynamiczone', components: ['shared.quote', 'fixture.link'] },
    tags: { type: 'relation', relation: 'manyToMany', target: 'api::label.label' },
    related: { type: 'relation', relation: 'manyToMany', target: 'api::post.post' },
  },
})
