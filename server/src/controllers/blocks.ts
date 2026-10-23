import type { Context } from 'koa'
import { BLOCKS } from '../../../contract/blocks'
import { blockJsonSchema } from '../../../contract/strapi'

/** `GET /micelio/blocks`, for an admin user: see `docs/api.md`. */
export default (): { find(ctx: Context): void } => ({
  find(ctx) {
    ctx.body = {
      data: BLOCKS.map(({ schema, ...block }) => ({
        ...block,
        component: schema.component,
        schema: blockJsonSchema({ schema, ...block }),
      })),
    }
  },
})
