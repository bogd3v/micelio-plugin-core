import type { Core } from '@strapi/strapi'
import type { Context } from 'koa'
import { BlockOptionError, BLOCK_OPTION_INVALID } from '../block-options/error'
import { BlockSettingError } from '../block-settings/error'
import {
  BLOCK_SETTING_INVALID,
  BLOCKS_MANAGE_PERMISSION,
  BLOCKS_READ_PERMISSION,
} from '../constants/blocks'
import type {
  BlockSettingInput,
  BlockSettingsService,
  BlockSite,
  PageReader,
} from '../services/block-settings'
import { sendProblem } from '../utils/problem'

interface UserAbility {
  can(action: string): boolean
}

interface PermissionChecker {
  cannot: { read(entity: unknown, field?: string): boolean }
}

type Handler = (ctx: Context) => Promise<void>

type Action = 'sites' | 'find' | 'usage' | 'update' | 'reset'

const FIELDS = ['enabled', 'allowedPageTypes', 'defaultOptions', 'labels'] as const

/**
 * The routes of the Block catalogue page (`docs/api.md`): reading the page needs
 * `plugin::micelio.blocks.read`, changing or resetting a block's settings
 * `plugin::micelio.blocks.manage`. The settings are written through the document service, so the
 * checks that guard every write to them guard these routes too.
 */
export default ({ strapi }: { strapi: Core.Strapi }): Record<Action, Handler> => {
  const settings = () => strapi.plugin('micelio').service('blockSettings') as BlockSettingsService

  function refuse(ctx: Context, status: number, title: string, code: string, detail: string) {
    sendProblem(ctx, { type: 'about:blank', title, status, detail, code })
  }

  function isAllowed(ctx: Context, permission: string): boolean {
    const ability = ctx.state.userAbility as UserAbility | undefined
    if (ability?.can(permission) === true) return true
    refuse(ctx, 403, 'Forbidden', 'blocksForbidden', `This needs the permission ${permission}.`)
    return false
  }

  /** Runs `work` for a caller with `permission`, on the site the request names. */
  async function guarded(
    ctx: Context,
    permission: string,
    work: (site: BlockSite) => Promise<void>
  ): Promise<void> {
    if (!isAllowed(ctx, permission)) return
    const slug = ctx.query.site
    const site = typeof slug === 'string' ? await settings().siteOf(slug) : null
    if (!site) {
      refuse(
        ctx,
        404,
        'Not Found',
        'unknownSite',
        typeof slug === 'string' ? `There is no site "${slug}".` : 'Name a site with ?site=.'
      )
      return
    }
    try {
      await work(site)
    } catch (error) {
      if (error instanceof BlockOptionError) {
        const { block, option, allowed } = error.violation
        sendProblem(ctx, {
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: error.message,
          code: BLOCK_OPTION_INVALID,
          block,
          option,
          allowed,
        })
      } else if (error instanceof BlockSettingError) {
        sendProblem(ctx, {
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: error.message,
          code: BLOCK_SETTING_INVALID,
          field: error.field,
        })
      } else {
        throw error
      }
    }
  }

  const blockOf = (ctx: Context): string => String(ctx.params.block)

  return {
    async sites(ctx) {
      if (!isAllowed(ctx, BLOCKS_READ_PERMISSION)) return
      ctx.body = { data: await settings().sites() }
    },

    find: (ctx) =>
      guarded(ctx, BLOCKS_READ_PERMISSION, async (site) => {
        ctx.set('Cache-Control', 'private, no-store')
        ctx.body = { data: await settings().view(site) }
      }),

    usage: (ctx) =>
      guarded(ctx, BLOCKS_READ_PERMISSION, async (site) => {
        ctx.set('Cache-Control', 'private, no-store')
        // A page is listed only when the caller may read it in the Content Manager (its type, its
        // locale and the conditions of the role), under the title the role may read; the count of
        // the page does not depend on it.
        const checkers = new Map<string, PermissionChecker>()
        const canRead: PageReader = (uid, row, field) => {
          let checker = checkers.get(uid)
          if (!checker) {
            checker = strapi
              .plugin('content-manager')
              .service('permission-checker')
              .create({ userAbility: ctx.state.userAbility, model: uid }) as PermissionChecker
            checkers.set(uid, checker)
          }
          return !checker.cannot.read(row, field)
        }
        ctx.body = { data: await settings().usage(site, blockOf(ctx), canRead) }
      }),

    update: (ctx) =>
      guarded(ctx, BLOCKS_MANAGE_PERMISSION, async (site) => {
        const body = ctx.request.body as unknown
        const sent =
          typeof body === 'object' && body !== null && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : undefined
        const unknown = sent
          ? Object.keys(sent).find((key) => !(FIELDS as readonly string[]).includes(key))
          : ''
        if (!sent || unknown !== undefined) {
          throw new BlockSettingError(
            'body',
            `The body takes ${FIELDS.join(', ')}${unknown ? `, not "${unknown}"` : ''}`
          )
        }
        ctx.body = { data: await settings().save(site, blockOf(ctx), sent as BlockSettingInput) }
      }),

    reset: (ctx) =>
      guarded(ctx, BLOCKS_MANAGE_PERMISSION, async (site) => {
        await settings().reset(site, blockOf(ctx))
        ctx.status = 204
      }),
  }
}
