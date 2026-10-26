import { factories, type UID } from '@strapi/strapi'
import { CATEGORY_UID, TAG_UID } from '../constants/taxonomy'
import { SITE_SCOPE_MIDDLEWARE } from '../site-scope'

// A new object for every route: Strapi writes the route's auth scope into its `config`, so routes
// that share one object all take the scope of the first (`plugin::micelio.category.find` for the
// writes of both types, which a read-only token would then pass).
const scoped = () => ({ middlewares: [SITE_SCOPE_MIDDLEWARE] })
const config = () => ({
  find: scoped(),
  findOne: scoped(),
  create: scoped(),
  update: scoped(),
  delete: scoped(),
})

/**
 * The content API routes of the category type: `/api/categories` and `/api/categories/:id`.
 *
 * @remarks
 * `prefix: ''` drops the `/micelio` segment a plugin's content-api routes get, so the paths are
 * those `micelio-cms` 0.5 and the frontend have (ADR-0017, amendments of 2026-10-21 and
 * 2026-10-26). A host that has routes of its own on these paths keeps them: host routes register
 * first.
 */
export const categoryRoutes = factories.createCoreRouter(CATEGORY_UID as UID.ContentType, {
  prefix: '',
  config: config(),
})
/** The content API routes of the tag type: `/api/tags` and `/api/tags/:id`, as {@link categoryRoutes}. */
export const tagRoutes = factories.createCoreRouter(TAG_UID as UID.ContentType, {
  prefix: '',
  config: config(),
})
