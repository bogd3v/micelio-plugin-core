const { factories } = require('@strapi/strapi')
const { SITE_SCOPE_MIDDLEWARE } = require('../../../../micelio.js')

const scoped = { middlewares: [SITE_SCOPE_MIDDLEWARE] }

module.exports = factories.createCoreRouter('api::category.category', {
  config: { find: scoped, findOne: scoped, create: scoped, update: scoped, delete: scoped },
})
