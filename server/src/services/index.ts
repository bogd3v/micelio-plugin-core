import { factories, type UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'
import hooks from './hooks'
import hostCheck from './host-check'
import transitions from './transitions'

export default {
  site: factories.createCoreService(SITE_UID as UID.ContentType),
  transitions,
  hostCheck,
  hooks,
}
