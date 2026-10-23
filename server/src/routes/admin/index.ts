import type { Core } from '@strapi/strapi'

// The prefix is explicit (ADR-0017, trade-offs): POST /micelio/transitions, GET /micelio/blocks. It is set on the
// router: a route's own `config.prefix` replaces the router's and does not add itself.
export default (): Core.RouterInput => ({
  type: 'admin',
  prefix: '/micelio',
  routes: [
    {
      method: 'POST',
      path: '/transitions',
      handler: 'transitions.perform',
      config: { policies: ['admin::isAuthenticatedAdmin'] },
    },
    {
      method: 'GET',
      path: '/blocks',
      handler: 'blocks.find',
      config: { policies: ['admin::isAuthenticatedAdmin'] },
    },
  ],
})
