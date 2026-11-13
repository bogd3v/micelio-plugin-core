import { factories, type UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'
import { CATEGORY_UID, TAG_UID } from '../constants/taxonomy'
import about from './about'
import blockSettings from './block-settings'
import budget from './budget'
import extensions from './extensions'
import hooks from './hooks'
import hostCheck from './host-check'
import icons from './icons'
import pageTemplates from './page-templates'
import preview from './preview'
import siteExport from './site-export'
import status from './status'
import transfers from './transfers'
import transitions from './transitions'

export default {
  site: factories.createCoreService(SITE_UID as UID.ContentType),
  category: factories.createCoreService(CATEGORY_UID as UID.ContentType),
  tag: factories.createCoreService(TAG_UID as UID.ContentType),
  transitions,
  hostCheck,
  hooks,
  icons,
  extensions,
  status,
  preview,
  budget,
  blockSettings,
  siteExport,
  pageTemplates,
  transfers,
  about,
}
