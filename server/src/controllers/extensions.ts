import type { Core } from '@strapi/strapi'
import type { Context } from 'koa'
import { SITE_UID } from '../constants/site'
import { extensionsOf } from '../extensions'
import { readSitesWithSections } from '../status/read'
import { sendProblem } from '../utils/problem'

interface UserAbility {
  can(action: string, subject?: string): boolean
}

type Handler = (ctx: Context) => Promise<void>

/** The Content Manager permission that lets an admin user read sites. */
const READ_SITES = 'plugin::content-manager.explorer.read'

/**
 * `GET /micelio/admin-pages` and `GET /micelio/sites`, the admin routes behind the extension
 * points: see `docs/api.md`.
 */
export default ({ strapi }: { strapi: Core.Strapi }): Record<'pages' | 'sites', Handler> => {
  const abilityOf = (ctx: Context) => ctx.state.userAbility as UserAbility | undefined

  return {
    async pages(ctx) {
      const ability = abilityOf(ctx)
      ctx.body = {
        data: extensionsOf(strapi)
          .adminPages()
          .filter(({ permission }) => ability?.can(permission) === true)
          .map(({ id, group, label, to }) => ({ id, group, label, to })),
      }
    },
    async sites(ctx) {
      const ability = abilityOf(ctx)
      if (ability?.can(READ_SITES, SITE_UID) !== true) {
        sendProblem(ctx, {
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          detail: 'Reading the sites needs the permission to read the Site content type.',
          code: 'sitesForbidden',
        })
        return
      }
      const readable = extensionsOf(strapi)
        .siteSections()
        .filter(({ permission }) => ability.can(permission))
        .map(({ id }) => id)
      ctx.body = { data: await readSitesWithSections(strapi, readable) }
    },
  }
}
