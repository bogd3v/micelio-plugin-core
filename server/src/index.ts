// The server entry point Strapi loads through the `./strapi-server` export. The plugin is empty
// on purpose: content types, services and routes arrive with the issues of phase 0 (epic #1).
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
