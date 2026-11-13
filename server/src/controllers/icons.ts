import type { Core } from '@strapi/strapi'
import type { Context } from 'koa'
import { readIcons } from '../icons/read'
import type { BlockSettingsService } from '../services/block-settings'
import type { IconsService } from '../services/icons'
import { sendProblem } from '../utils/problem'

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const whole = (value: unknown): number | undefined => {
  const number = Number(text(value))
  return Number.isInteger(number) && number >= 0 ? number : undefined
}

/**
 * `GET /micelio/icons`, for an admin user: see `docs/api.md`. `?site=<slug>` answers the sprite
 * entries that site resolves (the core's drawing for every name in step 1); an unknown slug answers
 * the problem detail `unknownSite`. `name` (one entry, an alias resolved), `q`, `category`, `locale` (`en` or `es`), `limit` and `offset`
 * narrow and page the entries.
 */
export default ({ strapi }: { strapi: Core.Strapi }): { find(ctx: Context): Promise<void> } => ({
  async find(ctx) {
    const { site: slug, q, name, category, locale, limit, offset } = ctx.query
    let site: string | undefined
    if (slug !== undefined) {
      const blockSettings = strapi
        .plugin('micelio')
        .service('blockSettings') as BlockSettingsService
      const found = await blockSettings.siteOf(String(slug))
      if (!found) {
        sendProblem(ctx, {
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          detail: `There is no site "${String(slug)}".`,
          code: 'unknownSite',
        })
        return
      }
      site = String(slug)
    }
    ctx.set('Cache-Control', 'private, no-store')
    ctx.body = {
      data: await readIcons(site, {
        q: text(q),
        name: text(name),
        aliases: (strapi.plugin('micelio').service('icons') as IconsService).catalogue.aliases,
        category: text(category),
        locale: locale === 'es' ? 'es' : 'en',
        limit: whole(limit),
        offset: whole(offset),
      }),
    }
  },
})
