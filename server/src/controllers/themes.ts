import type { Core } from '@strapi/strapi'
import type { Context } from 'koa'
import themeSchema from '../components/site/theme.json'
import { THEMES_MANAGE_PERMISSION } from '../constants/themes'
import { activateTheme, revertTheme, ThemeChangeError } from '../themes/activate'
import { readThemes } from '../themes/read'
import { sendProblem } from '../utils/problem'
import { createRateLimiter, type RateLimiter } from '../utils/rate-limit'

interface UserAbility {
  /** A plugin permission has no subject, so `can` takes the action alone. */
  can(action: string): boolean
}

type Handler = (ctx: Context) => Promise<void>

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  429: 'Too Many Requests',
  502: 'Bad Gateway',
}

// A change of the theme writes the pin and makes the frontend install: a few a minute per admin
// user, over activate and revert together, as `POST /micelio/about/refresh` (standard, section 9).
const CHANGE_LIMIT = 5
const CHANGE_WINDOW_SECONDS = 60

// The grammar of the site's pin: the regexes of its theme component.
const THEME_ID = new RegExp(themeSchema.attributes.themeId.regex)
const THEME_VERSION = new RegExp(themeSchema.attributes.themeVersion.regex)

/**
 * `GET /micelio/themes`, `POST /micelio/themes/activate` and `POST /micelio/themes/revert`, for an
 * admin user with the themes permission: see `docs/api.md`.
 */
export default ({
  strapi,
}: {
  strapi: Core.Strapi
}): Record<'find' | 'activate' | 'revert', Handler> => {
  const limiter = createRateLimiter(CHANGE_LIMIT, CHANGE_WINDOW_SECONDS)
  return {
    async find(ctx) {
      if (!isAllowed(ctx)) return
      const slug =
        typeof ctx.query.site === 'string' && ctx.query.site !== '' ? ctx.query.site : null
      const answer = await readThemes(strapi, slug)
      if (!answer) {
        refuse(ctx, 404, 'themeSiteNotFound', `There is no site "${slug}".`)
        return
      }
      ctx.set('Cache-Control', 'private, no-store')
      ctx.body = { data: answer }
    },

    async activate(ctx) {
      if (!isAllowed(ctx) || isLimited(ctx, limiter)) return
      const body = (ctx.request.body ?? {}) as Record<string, unknown>
      const { site, id, version } = body
      if (
        (site !== undefined && typeof site !== 'string') ||
        typeof id !== 'string' ||
        !THEME_ID.test(id) ||
        (version !== undefined && (typeof version !== 'string' || !THEME_VERSION.test(version)))
      ) {
        refuse(
          ctx,
          400,
          'themeRequestInvalid',
          'The body needs id, in the grammar of themeId; site is a slug and version an exact SemVer version, both optional.'
        )
        return
      }
      await answer(ctx, () =>
        activateTheme(strapi, { site: site ?? null, id, version }, adminUserOf(ctx))
      )
    },

    async revert(ctx) {
      if (!isAllowed(ctx) || isLimited(ctx, limiter)) return
      const { site } = (ctx.request.body ?? {}) as Record<string, unknown>
      if (site !== undefined && typeof site !== 'string') {
        refuse(ctx, 400, 'themeRequestInvalid', 'site is a slug, and optional.')
        return
      }
      await answer(ctx, () => revertTheme(strapi, { site: site ?? null }, adminUserOf(ctx)))
    },
  }
}

/**
 * Whether the admin user made more than five activations and reverts in the minute; answers the
 * `429` with `Retry-After` itself when so, before anything is read or written.
 */
function isLimited(ctx: Context, limiter: RateLimiter): boolean {
  const wait = limiter.hit(String(adminUserOf(ctx) ?? 'unknown'))
  if (wait === 0) return false
  ctx.set('Retry-After', String(wait))
  refuse(ctx, 429, 'themeChangeLimited', `Change the theme again in ${wait} seconds.`)
  return true
}

/** Answers what `work` returns, or its refusal as a problem detail. */
async function answer(ctx: Context, work: () => Promise<unknown>): Promise<void> {
  try {
    ctx.body = { data: await work() }
  } catch (error) {
    if (!(error instanceof ThemeChangeError)) throw error
    refuse(ctx, error.status, error.code, error.message)
  }
}

function refuse(ctx: Context, status: number, code: string, detail: string): void {
  sendProblem(ctx, { type: 'about:blank', title: TITLES[status] ?? 'Error', status, detail, code })
}

function adminUserOf(ctx: Context): number | null {
  const id = (ctx.state.user as { id?: unknown } | undefined)?.id
  return typeof id === 'number' ? id : null
}

/** Whether the admin may use the Themes page; answers the `403` itself when not. */
function isAllowed(ctx: Context): boolean {
  const ability = ctx.state.userAbility as UserAbility | undefined
  if (ability?.can(THEMES_MANAGE_PERMISSION) === true) return true
  refuse(
    ctx,
    403,
    'themesForbidden',
    `Changing the theme of a site needs the permission ${THEMES_MANAGE_PERMISSION}.`
  )
  return false
}
