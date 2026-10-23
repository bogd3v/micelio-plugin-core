import type { Core } from '@strapi/strapi'
import { registerComponents } from './components'
import { editorialGuard } from './editorial/guard'
import { siteScopeDocuments } from './site-scope/documents'
import { siteRules } from './sites/rules'

/** Register phase: runs before the database is ready. */
const register = ({ strapi }: { strapi: Core.Strapi }): void => {
  registerComponents(strapi)
  strapi.documents.use(siteRules(strapi))
  strapi.documents.use(siteScopeDocuments(strapi))
  strapi.documents.use(editorialGuard(strapi))
}

export default register
