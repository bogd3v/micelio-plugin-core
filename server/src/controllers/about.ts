import type { Core } from '@strapi/strapi'
import type { Context } from 'koa'
import type { AboutService } from '../services/about'
import { sendProblem } from '../utils/problem'
import { createRateLimiter } from '../utils/rate-limit'

/** "Run checks again" asks every frontend: a few times a minute per admin user is plenty. */
const REFRESH_LIMIT = 5
const REFRESH_WINDOW_SECONDS = 60

type Handler = (ctx: Context) => Promise<void>

/**
 * `GET /micelio/about` and `POST /micelio/about/refresh`, for every admin user: the page shows no
 * configuration, only versions, modes and counts (`docs/api.md`).
 */
export default ({ strapi }: { strapi: Core.Strapi }): Record<'find' | 'refresh', Handler> => {
  const about = () => strapi.plugin('micelio').service('about') as AboutService
  const limiter = createRateLimiter(REFRESH_LIMIT, REFRESH_WINDOW_SECONDS)
  return {
    async find(ctx) {
      ctx.body = { data: await about().read() }
    },
    async refresh(ctx) {
      const wait = limiter.hit(String((ctx.state.user as { id: number }).id))
      if (wait > 0) {
        ctx.set('Retry-After', String(wait))
        sendProblem(ctx, {
          type: 'about:blank',
          title: 'Too Many Requests',
          status: 429,
          detail: `Run the checks again in ${wait} seconds.`,
          code: 'aboutRefreshLimited',
        })
        return
      }
      ctx.body = { data: await about().refresh() }
    },
  }
}
