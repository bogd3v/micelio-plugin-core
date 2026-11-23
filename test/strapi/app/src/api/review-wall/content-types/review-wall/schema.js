// A fixture type for the testimonial rating suite: a site-scoped page of sections whose zone holds
// `section.testimonials`. Other fixtures keep their zones, so their suites keep counting the same
// blocks. Like the others it adds nothing of the distribution. It is left out of the archive
// (`export: never`); the import suite of the rating turns that off for its own run.
const { withSiteScope } = require('../../../../../micelio.js')

module.exports = withSiteScope({
  kind: 'collectionType',
  collectionName: 'review_walls',
  info: { singularName: 'review-wall', pluralName: 'review-walls', displayName: 'Review wall' },
  options: { draftAndPublish: true },
  pluginOptions: { micelio: { export: 'never' } },
  attributes: {
    title: { type: 'string', required: true },
    sections: {
      type: 'dynamiczone',
      components: ['section.testimonials'],
    },
  },
})
