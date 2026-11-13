import { factories, type UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'
import { CATEGORY_UID, TAG_UID } from '../constants/taxonomy'
import about from './about'
import blocks from './blocks'
import blockSettings from './block-settings'
import budget from './budget'
import pageTemplates from './page-templates'
import preview from './preview'
import redirects from './redirects'
import extensions from './extensions'
import icons from './icons'
import status from './status'
import transfers from './transfers'
import transitions from './transitions'

export default {
  site: factories.createCoreController(SITE_UID as UID.ContentType),
  category: factories.createCoreController(CATEGORY_UID as UID.ContentType),
  tag: factories.createCoreController(TAG_UID as UID.ContentType),
  blocks,
  blockSettings,
  pageTemplates,
  budget,
  transitions,
  status,
  preview,
  redirects,
  extensions,
  transfers,
  about,
  icons,
}
