import { factories, type UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'
import extensions from './extensions'
import hooks from './hooks'
import hostCheck from './host-check'
import preview from './preview'
import siteExport from './site-export'
import status from './status'
import transitions from './transitions'

export default {
  site: factories.createCoreService(SITE_UID as UID.ContentType),
  transitions,
  hostCheck,
  hooks,
  extensions,
  status,
  preview,
  siteExport,
}
