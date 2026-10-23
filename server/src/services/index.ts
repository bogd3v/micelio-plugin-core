import { factories, type UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'

export default {
  site: factories.createCoreService(SITE_UID as UID.ContentType),
}
