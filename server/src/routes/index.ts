import adminRoutes from './admin'
import contentApiRoutes from './content-api'
import siteRoutes from './site'

export default {
  'content-api': contentApiRoutes,
  admin: adminRoutes,
  site: siteRoutes,
}
