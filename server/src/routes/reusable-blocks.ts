import { factories, type UID } from '@strapi/strapi'
import { REUSABLE_BLOCK_UID } from '../constants/reusable-blocks'
import { SITE_SCOPE_MIDDLEWARE } from '../site-scope'

/**
 * The content API routes of the reusable blocks: `GET /api/reusable-blocks` and
 * `GET /api/reusable-blocks/:id`, read only and scoped to the request's site.
 *
 * @remarks
 * A page populates its reference through them: Strapi's content API resolves a relation only for a
 * token that may `find` its target. Writes go through the admin. `prefix: ''` as for the taxonomy
 * routes; each action has a config object of its own (`SITE_SCOPE_MIDDLEWARE`).
 */
export const reusableBlockRoutes = factories.createCoreRouter(
  REUSABLE_BLOCK_UID as UID.ContentType,
  {
    prefix: '',
    only: ['find', 'findOne'],
    config: {
      find: { middlewares: [SITE_SCOPE_MIDDLEWARE] },
      findOne: { middlewares: [SITE_SCOPE_MIDDLEWARE] },
    },
  }
)
