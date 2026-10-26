import type { Core } from '@strapi/strapi'
import { registerComponents } from './components'
import { editorialGuard } from './editorial/guard'
import { siteSectionInstances } from './extensions/site-sections'
import { hooksOf } from './hooks'
import { renameLegacyUids } from './migrations/rename-legacy-uids'
import { registerPreviewShortcut } from './preview/shortcut'
import { siteCreatedHook } from './sites/hooks'
import { siteScopeDocuments } from './site-scope/documents'
import { siteRules } from './sites/rules'

/** Register phase: runs before the database is ready. */
const register = ({ strapi }: { strapi: Core.Strapi }): void => {
  registerComponents(strapi)
  registerPreviewShortcut(strapi)
  // Before any plugin bootstraps: users-permissions deletes the permissions of an action that no
  // longer exists in its own bootstrap, and the rename has to reach them first (ADR-0017,
  // amendment of 2026-10-23).
  strapi.hook('strapi::content-types.beforeSync').register(async () => {
    const report = await renameLegacyUids(strapi)
    if (report.actions + report.subjects + report.layouts > 0) {
      strapi.log.info(`[micelio] moved legacy category and tag UIDs: ${JSON.stringify(report)}`)
    }
  })
  // Outermost, so the hook runs once `siteRules` has finished, the default switch included.
  strapi.documents.use(siteCreatedHook(strapi))
  strapi.documents.use(siteRules(strapi))
  strapi.documents.use(siteSectionInstances(strapi))
  strapi.documents.use(siteScopeDocuments(strapi))
  strapi.documents.use(editorialGuard(strapi))
  // `strapi.plugin('micelio').hooks`: the `hooks` service under the name the API documents.
  Object.defineProperty(strapi.plugin('micelio'), 'hooks', {
    value: hooksOf(strapi),
    enumerable: true,
  })
}

export default register
