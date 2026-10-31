import { createReadStream } from 'node:fs'
import type { Core } from '@strapi/strapi'
import type { Context } from 'koa'
import { TRANSFER_PERMISSION, TRANSFER_PERSONAL_PERMISSION } from '../constants/transfer'
import { extensionsOf } from '../extensions'
import { ExportError, type ExportErrorCode } from '../site-export/errors'
import type { ExistingPolicy } from '../site-export/importer'
import { TransferError, type Operator, type TransfersService } from '../services/transfers'
import type { ExportOptions } from '../types/transfer'
import { readSites } from '../status/read'
import { sendProblem } from '../utils/problem'

interface UserAbility {
  /** A plugin permission has no subject; a Content Manager one takes the UID of the type. */
  can(action: string, subject?: string): boolean
}

interface AdminUser {
  id: number
  firstname?: string | null
  lastname?: string | null
}

type Handler = (ctx: Context) => Promise<void>

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
}

const EXPORT_STATUS: Partial<Record<ExportErrorCode, number>> = {
  exportSiteNotFound: 404,
  exportSiteSlugTaken: 409,
  exportHostTaken: 409,
}

const TRANSFER_STATUS: Record<TransferError['code'], number> = {
  transferNotFound: 404,
  transferExpired: 410,
  exportQueueFull: 429,
  importNotStaged: 409,
  importNotConfirmed: 409,
  importBusy: 409,
  importQueueFull: 429,
}

const POLICIES: ExistingPolicy[] = ['skip', 'update', 'keep-both']

type Action =
  'sites' | 'options' | 'list' | 'exportSite' | 'download' | 'dryRun' | 'redoDryRun' | 'applyImport'

/**
 * The routes of the Export and import page, for an admin user with the transfer permission: see
 * `docs/api.md`. An export that holds personal data also needs the personal permission and, for
 * each personal section, the permission that section names.
 */
export default ({ strapi }: { strapi: Core.Strapi }): Record<Action, Handler> => {
  const transfers = () => strapi.plugin('micelio').service('transfers') as TransfersService

  function refuse(ctx: Context, status: number, code: string, detail: string): void {
    sendProblem(ctx, {
      type: 'about:blank',
      title: TITLES[status] ?? 'Error',
      status,
      detail,
      code,
    })
  }

  /** Runs `work` for an allowed caller and answers its refusals as problem details. */
  async function guarded(
    ctx: Context,
    work: (caller: { can: Operator['can']; operator: Operator }) => Promise<void>
  ): Promise<void> {
    const ability = ctx.state.userAbility as UserAbility | undefined
    if (ability?.can(TRANSFER_PERMISSION) !== true) {
      refuse(
        ctx,
        403,
        'transferForbidden',
        `Exporting and importing needs the permission ${TRANSFER_PERMISSION}.`
      )
      return
    }
    const user = ctx.state.user as AdminUser
    const name = [user.firstname, user.lastname].filter(Boolean).join(' ')
    try {
      const can: Operator['can'] = (action, subject) =>
        subject === undefined ? ability.can(action) : ability.can(action, subject)
      await work({ can, operator: { id: user.id, name: name || `Admin user ${user.id}`, can } })
    } catch (error) {
      if (error instanceof TransferError) {
        refuse(ctx, TRANSFER_STATUS[error.code], error.code, error.message)
      } else if (error instanceof ExportError) {
        refuse(ctx, EXPORT_STATUS[error.code] ?? 422, error.code, error.message)
      } else {
        throw error
      }
    }
  }

  const idOf = (ctx: Context): number => Number(ctx.params.id)
  const siteOf = (ctx: Context): string => String(ctx.query.site ?? '')
  const policyOf = (value: unknown): ExistingPolicy | undefined =>
    POLICIES.find((policy) => policy === value)

  return {
    sites: (ctx) =>
      guarded(ctx, async () => {
        const sites = await readSites(strapi)
        ctx.body = {
          data: sites.map(({ slug, name, isDefault }) => ({ slug, name, isDefault })),
        }
      }),

    options: (ctx) =>
      guarded(ctx, async ({ can }) => {
        const options = await transfers().options(siteOf(ctx), can)
        if (!options) {
          refuse(ctx, 404, 'exportSiteNotFound', `There is no site "${siteOf(ctx)}".`)
          return
        }
        ctx.body = { data: options }
      }),

    list: (ctx) =>
      guarded(ctx, async ({ operator }) => {
        const kind =
          ctx.query.kind === 'export' || ctx.query.kind === 'import' ? ctx.query.kind : undefined
        ctx.body = { data: await transfers().list(siteOf(ctx), kind, operator) }
      }),

    exportSite: (ctx) =>
      guarded(ctx, async ({ can, operator }) => {
        const body = (ctx.request.body ?? {}) as Partial<ExportOptions>
        const scope = { content: true, media: true, settings: true, drafts: true, ...body.scope }
        const include = Array.isArray(body.include) ? body.include.map(String) : []
        const personal = body.personal === true
        if (typeof body.site !== 'string' || body.site === '') {
          refuse(ctx, 400, 'exportSiteRequired', 'The request names no site.')
          return
        }
        const sections = extensionsOf(strapi).exportSections()
        const missing = [
          ...(personal && !can(TRANSFER_PERSONAL_PERMISSION) ? [TRANSFER_PERSONAL_PERMISSION] : []),
          ...include.flatMap((id) => {
            const permission = sections.find((section) => section.id === id)?.permission
            return permission && !can(permission) ? [permission] : []
          }),
        ]
        if (missing.length > 0) {
          refuse(
            ctx,
            403,
            'transferPersonalForbidden',
            `Including personal data needs the permission ${missing[0]}.`
          )
          return
        }
        if (personal || include.length > 0) {
          strapi.log.warn(
            `[micelio] personal data export of site "${body.site}" asked by admin user ${operator.id}` +
              (include.length > 0 ? ` (sections: ${include.join(', ')})` : '')
          )
        }
        ctx.status = 202
        ctx.body = {
          data: await transfers().startExport(
            {
              site: body.site,
              scope: {
                content: scope.content !== false,
                media: scope.media !== false,
                settings: scope.settings !== false,
                drafts: scope.drafts !== false,
              },
              personal,
              include,
            },
            operator
          ),
        }
      }),

    download: (ctx) =>
      guarded(ctx, async ({ operator }) => {
        const file = await transfers().fileOf(String(ctx.params.token), operator)
        ctx.set('Content-Type', 'application/gzip')
        ctx.set('Content-Disposition', `attachment; filename="${file.name}"`)
        ctx.body = createReadStream(file.path)
      }),

    dryRun: (ctx) =>
      guarded(ctx, async ({ operator }) => {
        const upload = (
          ctx.request.files as
            Record<string, { filepath: string; originalFilename?: string | null }> | undefined
        )?.file
        const existing = policyOf(ctx.request.body?.existing) ?? 'skip'
        if (!upload || typeof ctx.request.body?.site !== 'string') {
          refuse(ctx, 400, 'importFileRequired', 'The request needs a `file` and a `site`.')
          return
        }
        ctx.body = {
          data: await transfers().stageImport(
            { path: upload.filepath, name: upload.originalFilename || 'archive.micelio.tar.gz' },
            ctx.request.body.site,
            existing,
            operator
          ),
        }
      }),

    redoDryRun: (ctx) =>
      guarded(ctx, async ({ operator }) => {
        const existing = policyOf(ctx.request.body?.existing)
        if (!existing) {
          refuse(
            ctx,
            400,
            'importPolicyRequired',
            'The request needs `existing`: skip, update or keep-both.'
          )
          return
        }
        ctx.body = { data: await transfers().preview(idOf(ctx), existing, operator) }
      }),

    applyImport: (ctx) =>
      guarded(ctx, async ({ operator }) => {
        const existing = policyOf(ctx.request.body?.existing)
        if (!existing) {
          refuse(
            ctx,
            400,
            'importPolicyRequired',
            'The request needs `existing`: skip, update or keep-both.'
          )
          return
        }
        ctx.body = { data: await transfers().apply(idOf(ctx), existing, operator) }
      }),
  }
}
