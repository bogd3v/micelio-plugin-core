// A fixture type with a dynamic zone of blocks and no site: it is not made with `withSiteScope`, so
// the preview must not offer itself for it.
module.exports = {
  kind: 'collectionType',
  collectionName: 'sketches',
  info: { singularName: 'sketch', pluralName: 'sketches', displayName: 'Sketch' },
  options: { draftAndPublish: false },
  attributes: {
    title: { type: 'string', required: true },
    sections: { type: 'dynamiczone', components: ['section.rich-text'] },
  },
}
