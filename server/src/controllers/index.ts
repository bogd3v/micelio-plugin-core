import { factories, type UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'

export default {
  site: factories.createCoreController(SITE_UID as UID.ContentType),
}
