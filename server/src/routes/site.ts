import { factories, type UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'

// GET /api/micelio/sites and /api/micelio/sites/:id. The prefix is explicit (ADR-0017,
// trade-offs): a plugin's default could change, and an existing Strapi may have its own `/sites`.
export default factories.createCoreRouter(SITE_UID as UID.ContentType, {
  prefix: '/micelio',
  only: ['find', 'findOne'],
})
