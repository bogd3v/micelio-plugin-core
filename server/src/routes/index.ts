import adminRoutes from './admin'
import contentApiRoutes from './content-api'
import siteRoutes from './site'
import { categoryRoutes, tagRoutes } from './taxonomy'

export default {
  'content-api': contentApiRoutes,
  admin: adminRoutes,
  site: siteRoutes,
  category: categoryRoutes,
  tag: tagRoutes,
}
