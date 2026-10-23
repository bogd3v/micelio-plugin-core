import type { Core } from '@strapi/strapi'
import { registerComponents } from './components'
import { siteScopeDocuments } from './site-scope/documents'
import { siteRules } from './sites/rules'

/** Register phase: runs before the database is ready. */
const register = ({ strapi }: { strapi: Core.Strapi }): void => {
  registerComponents(strapi)
  strapi.documents.use(siteRules(strapi))
  strapi.documents.use(siteScopeDocuments(strapi))
}

export default register
