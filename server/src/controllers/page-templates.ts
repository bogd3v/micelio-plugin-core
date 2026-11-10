import type { Core } from '@strapi/strapi'
import type { Context } from 'koa'
import { BlockOptionError, BLOCK_OPTION_INVALID } from '../block-options/error'
import {
  CREATE_PERMISSION,
  TEMPLATE_CODES,
  TEMPLATES_MANAGE_PERMISSION,
} from '../constants/page-templates'
import { TemplateError } from '../page-templates/error'
import type {
  PageRequest,
  PageTarget,
  PageTemplatesService,
  TemplateRequest,
  TemplateSite,
} from '../services/page-templates'
import { readSites } from '../status/read'
import { sendProblem } from '../utils/problem'

interface UserAbility {
  can(action: string): boolean
}

interface PermissionChecker {
  cannot: {
    create(entity?: Record<string, unknown>, field?: string): boolean
    read(entity?: Record<string, unknown>, field?: string): boolean
    update(entity: Record<string, unknown>, field?: string): boolean
  }
  sanitizeCreateInput(data: Record<string, unknown>): Promise<Record<string, unknown>>
}

type Handler = (ctx: Context) => Promise<void>

type Action =
  | 'sites'
  | 'list'
  | 'manage'
  | 'detail'
  | 'update'
  | 'retire'
  | 'duplicate'
  | 'offer'
  | 'apply'
  | 'switchTo'
  | 'detach'
  | 'inspect'
  | 'save'
  | 'export'
  | 'import'
  | 'createPage'

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The routes of the page templates (`docs/api.md`): saving a page as a template, exporting and
 * importing one need `plugin::micelio.templates.manage`, and saving or inspecting a page also the
 * permission to read its zones of blocks in the Content Manager; reading the templates of a site
 * needs the permission to create that page type, and creating a page from one the permission to
 * create it in the request's locale.
 */
export default ({ strapi }: { strapi: Core.Strapi }): Record<Action, Handler> => {
  const templates = () => strapi.plugin('micelio').service('pageTemplates') as PageTemplatesService

  function refuse(ctx: Context, status: number, code: string, detail: string, more = {}) {
    sendProblem(ctx, {
      type: 'about:blank',
      title: TITLES[status] ?? 'Error',
      status,
      detail,
      code,
      ...more,
    })
  }

  async function failing(ctx: Context, work: () => Promise<void>): Promise<void> {
    try {
      await work()
    } catch (error) {
      if (error instanceof TemplateError) {
        refuse(ctx, error.status, error.code, error.message, error.extensions)
      } else if (error instanceof BlockOptionError) {
        const { block, option, allowed } = error.violation
        refuse(ctx, 400, BLOCK_OPTION_INVALID, error.message, { block, option, allowed })
      } else {
        throw error
      }
    }
  }

  function mayManage(ctx: Context): boolean {
    const ability = ctx.state.userAbility as UserAbility | undefined
    if (ability?.can(TEMPLATES_MANAGE_PERMISSION) === true) return true
    refuse(
      ctx,
      403,
      TEMPLATE_CODES.forbidden,
      `This needs the permission ${TEMPLATES_MANAGE_PERMISSION}.`
    )
    return false
  }

  function checkerOf(ctx: Context, uid: string): PermissionChecker | undefined {
    const model = strapi.contentTypes[uid as keyof typeof strapi.contentTypes]
    return model
      ? (strapi
          .plugin('content-manager')
          .service('permission-checker')
          .create({ userAbility: ctx.state.userAbility, model: uid }) as PermissionChecker)
      : undefined
  }

  function mayCreate(ctx: Context, uid: string): boolean {
    const checker = checkerOf(ctx, uid)
    if (checker && !checker.cannot.create()) return true
    refuse(
      ctx,
      403,
      TEMPLATE_CODES.forbidden,
      `This needs the permission ${CREATE_PERMISSION} on ${uid}.`
    )
    return false
  }

  /**
   * Whether the caller may create a page of `uid` in `locale` (the default locale when none is
   * named), as the Content Manager's checker reads a grant limited to some locales.
   */
  async function mayCreateIn(ctx: Context, uid: string, locale: string | undefined) {
    const checker = checkerOf(ctx, uid)
    const i18n = strapi.plugin('i18n')
    const resolved =
      locale ??
      (i18n
        ? ((await i18n.service('locales').getDefaultLocale()) as string | undefined)
        : undefined)
    if (
      checker &&
      !checker.cannot.create(resolved === undefined ? undefined : { locale: resolved })
    )
      return true
    refuse(
      ctx,
      403,
      TEMPLATE_CODES.forbidden,
      `This needs the permission ${CREATE_PERMISSION} on ${uid} in the locale ${resolved ?? '(none)'}.`
    )
    return false
  }

  async function siteOf(ctx: Context, slug: unknown): Promise<TemplateSite | null> {
    const site = typeof slug === 'string' ? await templates().siteOf(slug) : null
    if (!site) {
      refuse(
        ctx,
        404,
        'unknownSite',
        typeof slug === 'string' ? `There is no site "${slug}".` : 'Name a site with ?site=.'
      )
    }
    return site
  }

  const bodyOf = (ctx: Context): Record<string, unknown> => {
    const body = ctx.request.body as unknown
    return isRecord(body) ? body : {}
  }

  /** The name of the admin user who makes the request, for a template's history. */
  const byOf = (ctx: Context): string | undefined => {
    const user = ctx.state.user as
      { firstname?: string; lastname?: string; email?: string } | undefined
    const name = [user?.firstname, user?.lastname].filter(Boolean).join(' ')
    return name || user?.email
  }

  /** The page the Template tab acts on, read from the query or the body, with what the caller may do. */
  function targetOf(ctx: Context, source: Record<string, unknown>): PageTarget | undefined {
    const { uid, documentId, locale } = source
    if (
      typeof uid !== 'string' ||
      typeof documentId !== 'string' ||
      (locale !== undefined && locale !== null && typeof locale !== 'string')
    ) {
      refuse(ctx, 400, TEMPLATE_CODES.invalid, 'Name the page with uid, documentId and locale', {
        field: 'uid',
      })
      return undefined
    }
    const checker = checkerOf(ctx, uid)
    return {
      uid,
      documentId,
      locale: locale ?? undefined,
      mayRead: (draft) => checker !== undefined && !checker.cannot.read(draft),
      mayUpdate: (draft, zone) =>
        checker !== undefined && !checker.cannot.update(draft, zone === '' ? undefined : zone),
    }
  }

  function readRequest(ctx: Context, site: TemplateSite): TemplateRequest | undefined {
    const body = bodyOf(ctx)
    const { uid, documentId, locale, name, description, pageTypes, scope, blocks } = body
    const choices = Array.isArray(blocks)
      ? blocks.map((block) =>
          isRecord(block) && (block.content === 'sample' || block.content === 'clear')
            ? { content: block.content, fixed: block.fixed === true }
            : undefined
        )
      : undefined
    const isValid =
      typeof uid === 'string' &&
      typeof documentId === 'string' &&
      (scope === 'site' || scope === 'cms') &&
      (name === undefined || typeof name === 'string') &&
      (description === undefined || typeof description === 'string') &&
      (locale === undefined || locale === null || typeof locale === 'string') &&
      (pageTypes === undefined ||
        (Array.isArray(pageTypes) && pageTypes.every((type) => typeof type === 'string'))) &&
      (choices === undefined || choices.every((choice) => choice !== undefined))
    if (!isValid) {
      refuse(
        ctx,
        400,
        TEMPLATE_CODES.invalid,
        'The body takes uid, documentId, scope (site or cms), name, description, pageTypes, locale and blocks ([{ content: sample | clear, fixed }])',
        { field: 'body' }
      )
      return undefined
    }
    return {
      site,
      uid,
      documentId,
      locale: locale ?? undefined,
      name: (name as string | undefined) ?? '',
      description: description as string | undefined,
      pageTypes: pageTypes as string[] | undefined,
      scope,
      blocks: choices as TemplateRequest['blocks'],
      by: byOf(ctx),
    }
  }

  return {
    async sites(ctx) {
      const uid = ctx.query.uid
      // The Page templates page names no page type: it needs the permission to manage templates.
      if (uid === undefined) {
        if (!mayManage(ctx)) return
      } else if (typeof uid !== 'string') {
        refuse(ctx, 400, TEMPLATE_CODES.invalid, 'Name a page type with ?uid=.', { field: 'uid' })
        return
      } else if (!mayCreate(ctx, uid)) {
        return
      }
      const sites = await readSites(strapi)
      ctx.set('Cache-Control', 'private, no-store')
      ctx.body = { data: sites.map(({ slug, name, isDefault }) => ({ slug, name, isDefault })) }
    },

    async list(ctx) {
      const uid = ctx.query.uid
      if (typeof uid !== 'string' || !mayCreate(ctx, uid)) {
        if (typeof uid !== 'string')
          refuse(ctx, 400, TEMPLATE_CODES.invalid, 'Name a page type with ?uid=.', { field: 'uid' })
        return
      }
      const site = await siteOf(ctx, ctx.query.site)
      if (!site) return
      ctx.set('Cache-Control', 'private, no-store')
      ctx.body = { data: await templates().list(site) }
    },

    async manage(ctx) {
      if (!mayManage(ctx)) return
      const site = await siteOf(ctx, ctx.query.site)
      if (!site) return
      await failing(ctx, async () => {
        ctx.set('Cache-Control', 'private, no-store')
        ctx.body = {
          data: await templates().manage(site, (uid) => {
            const checker = checkerOf(ctx, uid)
            return checker !== undefined && !checker.cannot.read()
          }),
        }
      })
    },

    async detail(ctx) {
      if (!mayManage(ctx)) return
      await failing(ctx, async () => {
        const found = await templates().detail(String(ctx.params.id))
        if (!found) {
          refuse(ctx, 404, TEMPLATE_CODES.notFound, 'There is no such template')
          return
        }
        ctx.set('Cache-Control', 'private, no-store')
        ctx.body = { data: found }
      })
    },

    async update(ctx) {
      if (!mayManage(ctx)) return
      const { expectedVersion, blocks } = bodyOf(ctx)
      if (!Number.isInteger(expectedVersion)) {
        refuse(ctx, 400, TEMPLATE_CODES.invalid, 'The body takes expectedVersion and blocks', {
          field: 'expectedVersion',
        })
        return
      }
      await failing(ctx, async () => {
        ctx.body = {
          data: await templates().update(
            String(ctx.params.id),
            { expectedVersion: expectedVersion as number, blocks },
            byOf(ctx)
          ),
        }
      })
    },

    async retire(ctx) {
      if (!mayManage(ctx)) return
      const { retired } = bodyOf(ctx)
      if (typeof retired !== 'boolean') {
        refuse(ctx, 400, TEMPLATE_CODES.invalid, 'The body takes retired (true or false)', {
          field: 'retired',
        })
        return
      }
      await failing(ctx, async () => {
        ctx.body = { data: await templates().retire(String(ctx.params.id), retired) }
      })
    },

    async duplicate(ctx) {
      if (!mayManage(ctx)) return
      const site = await siteOf(ctx, ctx.query.site)
      if (!site) return
      await failing(ctx, async () => {
        ctx.status = 201
        ctx.body = {
          data: await templates().duplicate(String(ctx.params.id), site, byOf(ctx)),
        }
      })
    },

    async offer(ctx) {
      const target = targetOf(ctx, ctx.query)
      if (!target) return
      await failing(ctx, async () => {
        ctx.set('Cache-Control', 'private, no-store')
        ctx.body = { data: await templates().offer(target) }
      })
    },

    async apply(ctx) {
      const target = targetOf(ctx, bodyOf(ctx))
      if (!target) return
      await failing(ctx, async () => {
        ctx.body = { data: await templates().apply(target) }
      })
    },

    async switchTo(ctx) {
      const body = bodyOf(ctx)
      const target = targetOf(ctx, body)
      if (!target) return
      if (
        typeof body.to !== 'string' ||
        (body.dryRun !== undefined && typeof body.dryRun !== 'boolean')
      ) {
        refuse(ctx, 400, TEMPLATE_CODES.invalid, 'The body takes to (a template id) and dryRun', {
          field: 'to',
        })
        return
      }
      const { to, dryRun } = body as { to: string; dryRun?: boolean }
      await failing(ctx, async () => {
        ctx.body = { data: await templates().switchTo(target, to, dryRun !== false) }
      })
    },

    async detach(ctx) {
      if (!mayManage(ctx)) return
      const target = targetOf(ctx, bodyOf(ctx))
      if (!target) return
      await failing(ctx, async () => {
        ctx.body = { data: await templates().detach(target) }
      })
    },

    async inspect(ctx) {
      if (!mayManage(ctx)) return
      const site = await siteOf(ctx, ctx.query.site)
      const read = site ? readRequest(ctx, site) : undefined
      if (!read) return
      const checker = checkerOf(ctx, read.uid)
      const request: TemplateRequest = {
        ...read,
        // A field is checked as the Content Manager checks it: the zone the template copies, the title.
        mayRead: (draft, field) => checker !== undefined && !checker.cannot.read(draft, field),
      }
      await failing(ctx, async () => {
        ctx.set('Cache-Control', 'private, no-store')
        ctx.body = { data: await templates().inspect(request) }
      })
    },

    async save(ctx) {
      if (!mayManage(ctx)) return
      const site = await siteOf(ctx, ctx.query.site)
      const read = site ? readRequest(ctx, site) : undefined
      if (!read) return
      const checker = checkerOf(ctx, read.uid)
      const request: TemplateRequest = {
        ...read,
        // A field is checked as the Content Manager checks it: the zone the template copies, the title.
        mayRead: (draft, field) => checker !== undefined && !checker.cannot.read(draft, field),
      }
      await failing(ctx, async () => {
        ctx.status = 201
        ctx.body = { data: await templates().save(request) }
      })
    },

    async export(ctx) {
      if (!mayManage(ctx)) return
      await failing(ctx, async () => {
        ctx.set('Cache-Control', 'private, no-store')
        ctx.body = { data: await templates().export(String(ctx.params.id)) }
      })
    },

    async import(ctx) {
      if (!mayManage(ctx)) return
      const site = await siteOf(ctx, ctx.query.site)
      if (!site) return
      const scope = ctx.query.scope
      if (scope !== undefined && scope !== 'site' && scope !== 'cms') {
        refuse(ctx, 400, TEMPLATE_CODES.invalid, 'scope is site or cms', { field: 'scope' })
        return
      }
      await failing(ctx, async () => {
        ctx.status = 201
        ctx.body = { data: await templates().import(ctx.request.body, site, scope, byOf(ctx)) }
      })
    },

    async createPage(ctx) {
      const body = bodyOf(ctx)
      const { uid, site: slug, locale, title } = body
      if (typeof uid !== 'string' || !mayCreate(ctx, uid)) {
        if (typeof uid !== 'string') {
          refuse(ctx, 400, TEMPLATE_CODES.invalid, 'The body takes uid, site, title and locale', {
            field: 'uid',
          })
        }
        return
      }
      const site = await siteOf(ctx, slug)
      if (!site) return
      if (
        (locale !== undefined && typeof locale !== 'string') ||
        (title !== undefined && typeof title !== 'string')
      ) {
        refuse(ctx, 400, TEMPLATE_CODES.invalid, 'locale and title are texts', { field: 'body' })
        return
      }
      if (!(await mayCreateIn(ctx, uid, locale))) return
      const checker = checkerOf(ctx, uid)
      const request: PageRequest = {
        uid,
        site,
        locale,
        title,
        // What the Content Manager would keep of the data for this role; a field it strips is refused.
        mayWrite: async (data) => (checker ? await checker.sanitizeCreateInput(data) : {}),
      }
      await failing(ctx, async () => {
        ctx.status = 201
        ctx.body = { data: await templates().createPage(String(ctx.params.id), request) }
      })
    },
  }
}
