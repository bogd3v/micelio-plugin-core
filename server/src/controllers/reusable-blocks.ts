import type { Core } from '@strapi/strapi'
import type { Context } from 'koa'
import { REUSABLE_BLOCK_UID } from '../constants/reusable-blocks'
import type { ReusableBlocksService } from '../services/reusable-blocks'
import { sendProblem } from '../utils/problem'

interface UserAbility {
  can(action: string, subject?: string): boolean
}

const READ = 'plugin::content-manager.explorer.read'

/** The handler of the pages that show a reusable block. */
export interface ReusableBlocksController {
  usedOn(ctx: Context): Promise<void>
}

/**
 * `GET /micelio/reusable-blocks/:documentId/used-on?locale=`, for the builder's publish dialog
 * (`docs/api.md`): the pages of the block's site that show it, of the types the caller may read in
 * the Content Manager, and `total`, which counts every one of them.
 */
export default ({ strapi }: { strapi: Core.Strapi }): ReusableBlocksController => ({
  async usedOn(ctx) {
    const ability = ctx.state.userAbility as UserAbility | undefined
    if (ability?.can(READ, REUSABLE_BLOCK_UID) !== true) {
      sendProblem(ctx, {
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: `Listing the pages of a reusable block needs the permission ${READ} on ${REUSABLE_BLOCK_UID}.`,
        code: 'reusableBlockForbidden',
      })
      return
    }
    const locale = ctx.query.locale
    if (locale !== undefined && (typeof locale !== 'string' || locale === '')) {
      sendProblem(ctx, {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'locale is one locale code, or omitted for every locale',
        code: 'reusableBlockRequestInvalid',
      })
      return
    }
    const service = strapi.plugin('micelio').service('reusableBlocks') as ReusableBlocksService
    const pages = await service.usedOn({ documentId: String(ctx.params.documentId), locale })
    ctx.set('Cache-Control', 'private, no-store')
    ctx.body = {
      data: pages.filter((page) => ability.can(READ, page.uid)),
      meta: { total: pages.length },
    }
  },
})
