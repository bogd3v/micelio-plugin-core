// The server entry point Strapi loads through the `./strapi-server` export. Strapi reads the
// default export; the named exports are for the content types of other Micelio plugins.
import bootstrap from './bootstrap'
import config from './config'
import contentTypes from './content-types'
import controllers from './controllers'
import destroy from './destroy'
import middlewares from './middlewares'
import policies from './policies'
import register from './register'
import routes from './routes'
import services from './services'

export { SITE_ATTRIBUTE, SITE_SCOPE_MIDDLEWARE, withSiteScope } from './site-scope'
export { SITE_UID } from './constants/site'
export { withEditorial } from './editorial'
export { EDITORIAL_STATES, type EditorialState } from './constants/editorial'
export { missingLocales } from './extensions'
export { formatHostCheckReport } from './host-check/report'
export type { HostCheckReport, HostCheckResult, HostCheckStatus } from './types/host-check'
export type {
  AdminPageGroup,
  AdminPageRegistration,
  Check,
  ExportEntry,
  ExportSectionRegistration,
  ExtensionSite,
  LocalisedText,
  MicelioExtensions,
  SectionImportReport,
  SiteSectionRegistration,
  StatusChecksRegistration,
} from './types/extensions'
export type {
  BlockCatalogueChangedPayload,
  EntryPayload,
  HookActor,
  HookHandler,
  HookName,
  HookPayloads,
  MicelioHooks,
  SiteCreatedPayload,
  TransitionPayload,
} from './types/hooks'

export default {
  register,
  bootstrap,
  destroy,
  config,
  controllers,
  routes,
  services,
  contentTypes,
  policies,
  middlewares,
}
