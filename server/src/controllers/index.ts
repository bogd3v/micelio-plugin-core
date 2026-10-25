import { factories, type UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'
import blocks from './blocks'
import extensions from './extensions'
import status from './status'
import transitions from './transitions'

export default {
  site: factories.createCoreController(SITE_UID as UID.ContentType),
  blocks,
  transitions,
  status,
  extensions,
}
