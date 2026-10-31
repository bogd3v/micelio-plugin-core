import { factories, type UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'
import { CATEGORY_UID, TAG_UID } from '../constants/taxonomy'
import about from './about'
import blocks from './blocks'
import budget from './budget'
import preview from './preview'
import extensions from './extensions'
import status from './status'
import transfers from './transfers'
import transitions from './transitions'

export default {
  site: factories.createCoreController(SITE_UID as UID.ContentType),
  category: factories.createCoreController(CATEGORY_UID as UID.ContentType),
  tag: factories.createCoreController(TAG_UID as UID.ContentType),
  blocks,
  budget,
  transitions,
  status,
  preview,
  extensions,
  transfers,
  about,
}
