import { factories, type UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'
import transitions from './transitions'

export default {
  site: factories.createCoreController(SITE_UID as UID.ContentType),
  transitions,
}
