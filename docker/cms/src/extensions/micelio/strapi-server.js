// The inverse side of article.category and article.tags, which the core cannot declare: a plugin's
// type cannot target a type of the host. The distribution adds them the same way (ADR-0017,
// amendment of 2026-10-26, D5), and the attribute moves into the core with the type it targets.
module.exports = (plugin) => {
  const { category, tag } = plugin.contentTypes

  category.schema.attributes = {
    ...category.schema.attributes,
    articles: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'api::article.article',
      mappedBy: 'category',
    },
  }
  tag.schema.attributes = {
    ...tag.schema.attributes,
    articles: {
      type: 'relation',
      relation: 'manyToMany',
      target: 'api::article.article',
      mappedBy: 'tags',
    },
  }

  return plugin
}
