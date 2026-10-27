const { factories } = require('@strapi/strapi')
const { SITE_SCOPE_MIDDLEWARE } = require('../../../../micelio.js')

// One object per action: Strapi writes a route's `auth.scope` into the config it is given, so a shared
// one gives every action the scope of the first (`find`) and a read-only token could write.
const scoped = () => ({ middlewares: [SITE_SCOPE_MIDDLEWARE] })

module.exports = factories.createCoreRouter('api::note.note', {
  config: {
    find: scoped(),
    findOne: scoped(),
    create: scoped(),
    update: scoped(),
    delete: scoped(),
  },
})
