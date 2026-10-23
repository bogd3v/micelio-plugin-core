import type { Core } from '@strapi/strapi'
import { registerComponents } from './components'
import { editorialGuard } from './editorial/guard'
import { hooksOf } from './hooks'
import { siteCreatedHook } from './sites/hooks'
import { siteScopeDocuments } from './site-scope/documents'
import { siteRules } from './sites/rules'

/** Register phase: runs before the database is ready. */
const register = ({ strapi }: { strapi: Core.Strapi }): void => {
  registerComponents(strapi)
  // Outermost, so the hook runs once `siteRules` has finished, the default switch included.
  strapi.documents.use(siteCreatedHook(strapi))
  strapi.documents.use(siteRules(strapi))
  strapi.documents.use(siteScopeDocuments(strapi))
  strapi.documents.use(editorialGuard(strapi))
  // `strapi.plugin('micelio').hooks`: the `hooks` service under the name the API documents.
  Object.defineProperty(strapi.plugin('micelio'), 'hooks', {
    value: hooksOf(strapi),
    enumerable: true,
  })
}

export default register
