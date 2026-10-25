import type { Core } from '@strapi/strapi'
import { SITE_SCOPE_MIDDLEWARE } from '../../site-scope'

// The prefix is explicit (ADR-0017, trade-offs): the routes answer under /api/micelio. Both carry
// the site-scope middleware: the frontend names its site with `?site=`, as for any content API route.
export default (): Core.RouterInput => ({
  type: 'content-api',
  prefix: '/micelio',
  routes: [
    {
      method: 'POST',
      path: '/preview/exchange',
      handler: 'preview.exchange',
      config: { middlewares: [SITE_SCOPE_MIDDLEWARE] },
    },
    {
      method: 'GET',
      path: '/preview/draft',
      handler: 'preview.draft',
      config: { middlewares: [SITE_SCOPE_MIDDLEWARE] },
    },
  ],
})
