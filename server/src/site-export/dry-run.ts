// The dry run of an import: what it would create, update and skip, and write nothing.
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'
import type { Readable } from 'node:stream'
import { withStagedArchive } from './archive'
import { inspectDocument } from './inspect'
import { planImport, siteData, unknownRoles, validate, type Plan } from './import-plan'
import type { ExistingPolicy, ImportRequest } from './importer'
import { exportedTypes } from './model'
import { skippedSections } from './sections'
import { findMedia } from './store-media'

/** What an import would do with the documents of one export name. */
export interface ImportPreviewType {
  /** Documents of the archive. */
  inFile: number
  create: number
  update: number
  /** Documents the target holds as the archive has them, or that the policy leaves alone. */
  skip: number
  /** Documents with a published version that arrive as drafts: the caller may not publish the type. */
  asDraft: number
}

/** What an import of an archive would do, as the dry run answers it. */
export interface ImportPreview {
  /** The archive's format version, the release line and version of the core that wrote it. */
  archive: {
    formatVersion: string
    micelio: string
    generator: string
    exportedAt: string
    personal: boolean
    bytes: number
  }
  /** The target's site the archive would be written into. */
  site: { documentId: string; slug: string }
  existing: ExistingPolicy
  types: Record<string, ImportPreviewType>
  /** `inFile` files, of which `reused` the library holds already, by SHA-256. */
  media: { inFile: number; reused: number }
  /** The theme pin of the archive; `matches` when the target's site has the same one. */
  theme: { id: string; version: string | null; matches: boolean } | null
  /** Export names of the archive the target has no type for: not imported. */
  unknownTypes: string[]
  /** Role codes of the site's `editorialPolicy` the target does not have. */
  unknownRoles: string[]
  /** References to documents neither the archive nor the target holds: left out. */
  missingReferences: number
  /** Sections of the archive no plugin reads: no plugin registered them, or another major. */
  skippedPlugins: string[]
}

/**
 * Reads and checks an archive as an import does, and answers what the import would do.
 *
 * @remarks
 * Nothing is written: no media is stored and no document touched. The decision for each document
 * is the one {@link inspectDocument} takes for the import, so the numbers of the preview are those
 * of the report when the target has not changed in between.
 *
 * @throws `ExportError`, with every code an import refuses with before it writes.
 */
export async function previewImport(
  strapi: Core.Strapi,
  source: Readable,
  request: ImportRequest = {}
): Promise<ImportPreview> {
  return withStagedArchive(
    source,
    async (staged) => {
      const all = exportedTypes(strapi, true)
      const archived = new Set(staged.manifest.types.map((type) => type.name))
      const types = all.filter((type) => archived.has(type.name))
      const plan = await planImport(strapi, staged, types, request)
      const missingReferences = validate(strapi, plan)

      const files = await findMedia(strapi, staged.media)
      const shaOf = new Map([...files.entries()].map(([sha256, id]) => [id, sha256]))
      const counts: Record<string, ImportPreviewType> = {}
      for (const type of types) {
        const documents = plan.staged.contents.get(type.name)!.documents
        const count = { inFile: documents.length, create: 0, update: 0, skip: 0, asDraft: 0 }
        for (const document of documents) {
          const { result, asDraft } = await inspectDocument(strapi, plan, type, document, shaOf)
          if (asDraft && result !== 'skipped') count.asDraft += 1
          if (result === 'created') count.create += 1
          else if (result === 'replaced') count.update += 1
          else count.skip += 1
        }
        counts[type.name] = count
      }

      return {
        archive: {
          formatVersion: staged.manifest.formatVersion,
          micelio: staged.manifest.micelio,
          generator: `${staged.manifest.generator.name} ${staged.manifest.generator.version}`,
          exportedAt: staged.manifest.exportedAt,
          personal: staged.manifest.personal,
          bytes: Object.values(staged.manifest.files).reduce((sum, file) => sum + file.bytes, 0),
        },
        site: { documentId: plan.site.documentId, slug: plan.site.slug },
        existing: plan.existing,
        types: counts,
        media: { inFile: staged.media.length, reused: files.size },
        theme: await themeOf(strapi, plan, siteData(plan)),
        unknownTypes: [...archived]
          .filter((name) => !all.some((type) => type.name === name))
          .sort(),
        unknownRoles: await unknownRoles(strapi, siteData(plan)),
        missingReferences,
        skippedPlugins: skippedSections(strapi, staged.manifest.plugins)
          .map(({ id }) => id)
          .sort(),
      }
    },
    request.maxBytes
  )
}

// The archive's theme pin, and whether the target's site has the same one.
async function themeOf(
  strapi: Core.Strapi,
  plan: Plan,
  data: Record<string, unknown>
): Promise<ImportPreview['theme']> {
  const pin = data.theme as { themeId?: unknown; themeVersion?: unknown } | null | undefined
  if (typeof pin?.themeId !== 'string') return null
  const version = typeof pin.themeVersion === 'string' ? pin.themeVersion : null
  const rows = (await strapi.db.query(SITE_UID as UID.ContentType).findMany({
    where: { documentId: plan.site.documentId },
    populate: { theme: true },
  })) as { theme?: { themeId?: string | null; themeVersion?: string | null } | null }[]
  const held = rows[0]?.theme
  return {
    id: pin.themeId,
    version,
    matches: held?.themeId === pin.themeId && (held.themeVersion ?? null) === version,
  }
}
