import type { Core } from '@strapi/strapi'
import type { Context } from 'koa'
import { BLOCKS } from '../../../contract/blocks'
import { blockJsonSchema } from '../../../contract/strapi'
import type { BlockSettingsService } from '../services/block-settings'
import { sendProblem } from '../utils/problem'

/**
 * `GET /micelio/blocks`, for an admin user: see `docs/api.md`. With `?site=<slug>` it answers the
 * catalogue as that site sees it (the blocks it has not disabled, with its default options and the
 * page types each is allowed in); an unknown slug answers the problem detail `unknownSite`.
 */
export default ({ strapi }: { strapi: Core.Strapi }): { find(ctx: Context): Promise<void> } => ({
  async find(ctx) {
    const slug = ctx.query.site
    if (slug === undefined) {
      ctx.body = {
        data: BLOCKS.map(({ schema, ...block }) => ({
          ...block,
          component: schema.component,
          schema: blockJsonSchema({ schema, ...block }),
        })),
      }
      return
    }
    const blockSettings = strapi.plugin('micelio').service('blockSettings') as BlockSettingsService
    const site = await blockSettings.siteOf(String(slug))
    if (!site) {
      sendProblem(ctx, {
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: `There is no site "${String(slug)}".`,
        code: 'unknownSite',
      })
      return
    }
    ctx.set('Cache-Control', 'private, no-store')
    ctx.body = { data: await blockSettings.merged(site) }
  },
})
