import type { Core } from '@strapi/strapi'
import { registerComponents } from './components'

/** Register phase: runs before the database is ready. */
const register = ({ strapi }: { strapi: Core.Strapi }): void => {
  registerComponents(strapi)
}

export default register
