import { randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Core, UID } from '@strapi/strapi'
import { extensionsOf } from '../extensions'
import {
  ARCHIVE_EXTENSION,
  DEFAULT_TRANSFER_MAX_BYTES,
  MAX_STAGED_PER_USER,
  PUBLISH_PERMISSION,
  TRANSFER_PERSONAL_PERMISSION,
  TRANSFERS_FOLDER,
  TRANSFER_EXPIRY_MS,
  TRANSFER_UID,
} from '../constants/transfer'
import { SITE_UID } from '../constants/site'
import { ExportError } from '../site-export/errors'
import type { ExistingPolicy } from '../site-export/importer'
import type { SiteExportService } from './site-export'
import { countSite } from '../transfers/summary'
import type {
  ExportDetails,
  ExportOptions,
  ImportDetails,
  TransferOptions,
  TransferRecord,
} from '../types/transfer'

/** The admin user an export or import is made for. */
export interface Operator {
  id: number
  /** The name shown in the history. */
  name: string
  /** Whether the user holds an admin permission; `subject` is a content type's UID. */
  can(action: string, subject?: string): boolean
}

/** Why a transfer route refuses, besides the `ExportError`s of the export and import themselves. */
export class TransferError extends Error {
  constructor(
    readonly code:
      | 'transferNotFound'
      | 'transferExpired'
      | 'exportQueueFull'
      | 'importNotStaged'
      | 'importNotConfirmed'
      | 'importBusy'
      | 'importQueueFull',
    message: string
  ) {
    super(message)
    this.name = 'TransferError'
  }
}

/** The `transfers` service: the Export and import page's jobs and history. */
export interface TransfersService {
  /** The counts and sections the page shows before an export; `null` when no site has the slug. */
  options(site: string, can: (permission: string) => boolean): Promise<TransferOptions | null>
  /**
   * The history of a site, newest first; the archives past their 24 hours are removed first. Only
   * the maker of an export is given its `downloadToken`.
   */
  list(
    site: string,
    kind: 'export' | 'import' | undefined,
    operator: Operator
  ): Promise<TransferRecord[]>
  /**
   * Queues an export and answers at once; it runs in the background, one at a time.
   *
   * @throws {@link TransferError} `exportQueueFull`, `ExportError` `exportSiteNotFound` and
   * `exportSectionUnknown`.
   */
  startExport(options: ExportOptions, operator: Operator): Promise<TransferRecord>
  /**
   * The file of a ready export, by the token only its maker was given.
   *
   * @remarks
   * Another admin user, and a maker who no longer holds the permission for the personal data the
   * export holds, get `transferNotFound`: the answer does not tell them the export exists.
   *
   * @throws {@link TransferError} `transferNotFound` or `transferExpired`.
   */
  fileOf(token: string, operator: Operator): Promise<{ path: string; name: string }>
  /**
   * Keeps an uploaded archive for 24 hours and runs its dry run into `site`.
   *
   * @throws `ExportError` as the dry run does, `exportArchiveCorrupt` for an archive over
   * `transferMaxBytes`; nothing is kept then. {@link TransferError} `importQueueFull` when the
   * operator already holds three staged archives.
   */
  stageImport(
    upload: { path: string; name: string },
    site: string,
    existing: ExistingPolicy,
    operator: Operator
  ): Promise<TransferRecord>
  /**
   * Runs the dry run of a staged import again, with another policy.
   *
   * @throws {@link TransferError} `transferNotFound` (also for another operator's import),
   * `transferExpired` or `importNotStaged`.
   */
  preview(id: number, existing: ExistingPolicy, operator: Operator): Promise<TransferRecord>
  /**
   * Applies a staged import, with the policy of its last dry run: nothing is written without it.
   *
   * @throws {@link TransferError} `importNotConfirmed` when `existing` is not the policy the last
   * dry run ran with, and the ones of `preview`; `ExportError` when the import is refused.
   */
  apply(id: number, existing: ExistingPolicy, operator: Operator): Promise<TransferRecord>
  /** Marks the exports a restart interrupted as failed; run at boot. */
  failInterrupted(): Promise<number>
}

/** Most exports waiting or running at once. */
const MAX_PENDING = 3

interface Row {
  id: number
  kind: TransferRecord['kind']
  status: TransferRecord['status']
  siteSlug: string
  name: string
  operator: string | null
  operatorId: number | null
  downloadToken: string | null
  options: unknown
  summary: unknown
  bytes: string | number | null
  error: string | null
  hasFile: boolean
  expiresAt: string
  createdAt: string
}

export default ({ strapi }: { strapi: Core.Strapi }): TransfersService => {
  const store = () => strapi.db.query(TRANSFER_UID as UID.ContentType)
  const siteExport = () => strapi.plugin('micelio').service('siteExport') as SiteExportService
  const waiting: (() => Promise<void>)[] = []
  let isDraining = false
  let isApplying = false

  const directory = async (): Promise<string> => {
    const configured = strapi.config.get<string | undefined>('plugin::micelio.transfersDirectory')
    const folder = configured ?? path.join(strapi.dirs.app.root, '.tmp', TRANSFERS_FOLDER)
    await mkdir(folder, { recursive: true })
    return folder
  }
  const fileName = (id: number) => `transfer-${id}${ARCHIVE_EXTENSION}`

  async function drain(): Promise<void> {
    if (isDraining) return
    isDraining = true
    try {
      for (let job = waiting.shift(); job; job = waiting.shift()) await job()
    } catch (error) {
      // A job that cannot even record its failure (the database is gone) must not reject unseen.
      strapi.log.error(`[micelio] the export queue stopped: ${String(error)}`)
    } finally {
      isDraining = false
    }
  }

  const maxBytes = () =>
    strapi.config.get<number | undefined>('plugin::micelio.transferMaxBytes') ??
    DEFAULT_TRANSFER_MAX_BYTES
  const canPublish = (operator: Operator) => (uid: string) => operator.can(PUBLISH_PERMISSION, uid)
  /** What an import is asked with besides the policy: the caller's limits. */
  const requestOf = (row: Row, existing: ExistingPolicy, operator: Operator) => ({
    into: row.siteSlug,
    existing,
    keepIdentity: true,
    canPublish: canPublish(operator),
    maxBytes: maxBytes(),
  })

  /** The record a caller is shown: the download token is its maker's alone. */
  function toRecord(row: Row, operator?: Operator): TransferRecord {
    const isAvailable = row.hasFile && new Date(row.expiresAt).getTime() > Date.now()
    return {
      downloadToken:
        isAvailable && row.kind === 'export' && operator && row.operatorId === operator.id
          ? row.downloadToken
          : null,
      id: row.id,
      kind: row.kind,
      status: row.status,
      siteSlug: row.siteSlug,
      name: row.name,
      operator: row.operator,
      bytes: row.bytes === null ? null : Number(row.bytes),
      expiresAt: row.expiresAt,
      isAvailable,
      createdAt: row.createdAt,
      error: row.error,
      details: (row.kind === 'export' ? row.summary : row.options) as TransferRecord['details'],
    }
  }

  async function sweep(): Promise<void> {
    const due = (await store().findMany({
      where: { hasFile: true, expiresAt: { $lt: new Date().toISOString() } },
    })) as Row[]
    for (const row of due) {
      await rm(path.join(await directory(), fileName(row.id)), { force: true })
      await store().update({ where: { id: row.id }, data: { hasFile: false } })
    }
  }

  async function find(
    where: { id: number } | { downloadToken: string },
    kind: 'export' | 'import',
    operator: Operator
  ): Promise<Row> {
    const row = (await store().findOne({ where })) as Row | null
    if (!row || row.kind !== kind || row.operatorId !== operator.id) {
      throw new TransferError('transferNotFound', 'There is no such transfer')
    }
    return row
  }

  async function create(
    data: Record<string, unknown>,
    site: string,
    operator: Operator
  ): Promise<Row> {
    // The store is read through `strapi.db.query`, so only the create names the site.
    const row = (await strapi.db
      .query(SITE_UID as UID.ContentType)
      .findOne({ where: { slug: site }, select: ['id'] })) as { id: number } | null
    if (!row) throw new ExportError('exportSiteNotFound', `There is no site "${site}"`)
    return (await store().create({
      data: {
        ...data,
        siteSlug: site,
        operator: operator.name,
        operatorId: operator.id,
        expiresAt: new Date(Date.now() + TRANSFER_EXPIRY_MS).toISOString(),
        site: row.id,
      },
    })) as Row
  }

  async function runExport(row: Row, options: ExportOptions): Promise<void> {
    const final = path.join(await directory(), fileName(row.id))
    const partial = `${final}.partial`
    await store().update({ where: { id: row.id }, data: { status: 'running' } })
    try {
      const manifest = await siteExport().export(
        {
          site: options.site,
          personal: options.personal,
          include: options.include,
          scope: options.scope,
        },
        createWriteStream(partial)
      )
      await rename(partial, final)
      const details: ExportDetails = {
        scope: options.scope,
        personal: manifest.personal,
        include: options.include,
        documents: manifest.types.reduce((sum, type) => sum + type.documents, 0),
        mediaFiles: manifest.media.count,
      }
      await store().update({
        where: { id: row.id },
        data: {
          status: 'ready',
          hasFile: true,
          bytes: String((await stat(final)).size),
          summary: details,
          // The 24 hours count from the file, not from the request.
          expiresAt: new Date(Date.now() + TRANSFER_EXPIRY_MS).toISOString(),
        },
      })
    } catch (error) {
      await rm(partial, { force: true })
      const cause =
        error instanceof ExportError ? `${error.code}: ${error.message}` : 'exportFailed'
      if (!(error instanceof ExportError))
        strapi.log.error(`[micelio] export failed: ${String(error)}`)
      await store().update({ where: { id: row.id }, data: { status: 'failed', error: cause } })
    }
  }

  async function dryRun(row: Row, existing: ExistingPolicy, operator: Operator): Promise<Row> {
    const file = path.join(await directory(), fileName(row.id))
    const preview = await siteExport().preview(
      createReadStream(file),
      requestOf(row, existing, operator)
    )
    const details: ImportDetails = { existing, preview, report: null }
    return (await store().update({
      where: { id: row.id },
      data: { options: details, bytes: String((await stat(file)).size) },
    })) as Row
  }

  async function staged(id: number, operator: Operator): Promise<Row> {
    await sweep()
    const row = await find({ id }, 'import', operator)
    if (row.status !== 'staged') {
      throw new TransferError('importNotStaged', 'This import is not waiting for a dry run')
    }
    if (!row.hasFile) throw new TransferError('transferExpired', 'The uploaded archive expired')
    return row
  }

  return {
    async options(site, can) {
      const counts = await countSite(strapi, site)
      if (!counts) return null
      return {
        ...counts,
        sections: extensionsOf(strapi)
          .exportSections()
          .filter((section) => section.personalData && can(section.permission))
          .map(({ id, label }) => ({ id, label: label ?? id })),
        canIncludePersonal: can('plugin::micelio.transfer.personal'),
      }
    },

    async list(site, kind, operator) {
      await sweep()
      const rows = (await store().findMany({
        where: { siteSlug: site, ...(kind ? { kind } : {}) },
        orderBy: { id: 'desc' },
        limit: 50,
      })) as Row[]
      return rows.map((row) => toRecord(row, operator))
    },

    async startExport(options, operator) {
      await sweep()
      const pending = await store().count({
        where: { kind: 'export', status: { $in: ['queued', 'running'] } },
      })
      if (pending >= MAX_PENDING) {
        throw new TransferError('exportQueueFull', 'Too many exports are waiting: try again later')
      }
      // Refused now, not in the background, when a section was never registered.
      for (const id of options.include) {
        if (
          !extensionsOf(strapi)
            .exportSections()
            .some((section) => section.id === id)
        ) {
          throw new ExportError('exportSectionUnknown', `There is no export section "${id}"`)
        }
      }
      const stamp = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, 'Z')
      const row = await create(
        {
          kind: 'export',
          status: 'queued',
          name: `${options.site}-${stamp}${ARCHIVE_EXTENSION}`,
          downloadToken: randomBytes(24).toString('base64url'),
          summary: {
            scope: options.scope,
            personal: options.personal,
            include: options.include,
          } as Partial<ExportDetails>,
        },
        options.site,
        operator
      )
      waiting.push(() => runExport(row, options))
      void drain()
      return toRecord(row, operator)
    },

    async fileOf(token, operator) {
      await sweep()
      const row = await find({ downloadToken: token }, 'export', operator)
      if (row.status !== 'ready') {
        throw new TransferError('transferNotFound', 'There is no such transfer')
      }
      // Permissions change after an export: the personal data needs them at download too.
      const held = row.summary as Partial<ExportDetails> | null
      const needed = [
        ...(held?.personal ? [TRANSFER_PERSONAL_PERMISSION] : []),
        ...(held?.include ?? []).map(
          (id) =>
            extensionsOf(strapi)
              .exportSections()
              .find((section) => section.id === id)?.permission ?? TRANSFER_PERSONAL_PERMISSION
        ),
      ]
      if (needed.some((permission) => !operator.can(permission))) {
        throw new TransferError('transferNotFound', 'There is no such transfer')
      }
      if (!row.hasFile) throw new TransferError('transferExpired', 'The export expired')
      return { path: path.join(await directory(), fileName(row.id)), name: row.name }
    },

    async stageImport(upload, site, existing, operator) {
      await sweep()
      const held = await store().count({
        where: { kind: 'import', status: 'staged', hasFile: true, operatorId: operator.id },
      })
      if (held >= MAX_STAGED_PER_USER) {
        throw new TransferError(
          'importQueueFull',
          `You already hold ${MAX_STAGED_PER_USER} uploaded archives: apply or wait for one to expire`
        )
      }
      const row = await create(
        {
          kind: 'import',
          status: 'staged',
          name: upload.name,
          hasFile: true,
          options: { existing, preview: null, report: null } satisfies ImportDetails,
        },
        site,
        operator
      )
      const file = path.join(await directory(), fileName(row.id))
      try {
        await copyFile(upload.path, file)
        return toRecord(await dryRun(row, existing, operator), operator)
      } catch (error) {
        // The archive's documents are another site's: it is kept so that the page can offer
        // `keep-both`, which is the one policy that imports them.
        if (error instanceof ExportError && error.reason === 'otherSite') {
          return toRecord(
            (await store().update({
              where: { id: row.id },
              data: {
                options: { existing, preview: null, report: null, conflict: error.message },
                bytes: String((await stat(file)).size),
              },
            })) as Row,
            operator
          )
        }
        // Nothing of a refused archive is kept.
        await rm(file, { force: true })
        await store().delete({ where: { id: row.id } })
        throw error
      }
    },

    async preview(id, existing, operator) {
      const row = await staged(id, operator)
      try {
        return toRecord(await dryRun(row, existing, operator), operator)
      } catch (error) {
        if (!(error instanceof ExportError && error.reason === 'otherSite')) throw error
        return toRecord(
          (await store().update({
            where: { id },
            data: { options: { existing, preview: null, report: null, conflict: error.message } },
          })) as Row,
          operator
        )
      }
    },

    async apply(id, existing, operator) {
      const row = await staged(id, operator)
      const details = row.options as ImportDetails
      if (!details.preview || details.existing !== existing) {
        throw new TransferError('importNotConfirmed', 'Run the dry run with this choice first')
      }
      if (isApplying) throw new TransferError('importBusy', 'Another import is running')
      isApplying = true
      const file = path.join(await directory(), fileName(row.id))
      try {
        const report = await siteExport().import(
          createReadStream(file),
          requestOf(row, existing, operator)
        )
        await rm(file, { force: true })
        strapi.log.info(
          `[micelio] import into site "${row.siteSlug}" applied by admin user ${operator.id}`
        )
        return toRecord(
          (await store().update({
            where: { id },
            data: {
              status: 'applied',
              hasFile: false,
              options: { ...details, report } satisfies ImportDetails,
            },
          })) as Row,
          operator
        )
      } catch (error) {
        const cause =
          error instanceof ExportError ? `${error.code}: ${error.message}` : 'importFailed'
        await store().update({ where: { id }, data: { status: 'failed', error: cause } })
        throw error
      } finally {
        isApplying = false
      }
    },

    async failInterrupted() {
      const result = (await store().updateMany({
        where: { kind: 'export', status: { $in: ['queued', 'running'] } },
        data: { status: 'failed', error: 'exportInterrupted: the CMS restarted during the export' },
      })) as { count: number }
      return result.count
    },
  }
}
