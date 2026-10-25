// The sections that sibling plugins add to the archive (`docs/export-format.md`, "Plugin sections").
import type { Core } from '@strapi/strapi'
import { PLUGIN_SECTIONS_FOLDER } from '../constants/extensions'
import { extensionsOf } from '../extensions'
import type {
  ExportEntry,
  ExportSectionRegistration,
  ExtensionSite,
  SectionImportReport,
} from '../types/extensions'
import { ExportError } from './errors'
import { compare } from './model'
import type { TarFile } from './tar'
import type { ManifestPlugin } from './types'

const ENTRY_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/
const FORMAT_MAJOR = /^(\d+)\./

/** What an import did with the sections of an archive. */
export interface SectionsReport {
  /** What each section's `read` answered, by section `id`. */
  sections: Record<string, SectionImportReport>
  /** Sections of the archive that were not read, and why. */
  skipped: { id: string; reason: 'unknown' | 'version' }[]
}

/**
 * The sections an export includes: every one without personal data, and the personal ones named
 * in `include`.
 *
 * @throws `ExportError` `exportSectionUnknown` when `include` names a section nobody registered.
 */
export function selectSections(
  strapi: Core.Strapi,
  include: string[]
): ExportSectionRegistration[] {
  const registered = extensionsOf(strapi).exportSections()
  for (const id of include) {
    if (!registered.some((section) => section.id === id)) {
      throw new ExportError('exportSectionUnknown', `There is no export section "${id}"`)
    }
  }
  return registered
    .filter((section) => !section.personalData || include.includes(section.id))
    .sort((a, b) => compare(a.id, b.id))
}

/** The files and the manifest entries of the sections, for one site. */
export async function writeSections(
  strapi: Core.Strapi,
  sections: ExportSectionRegistration[],
  site: ExtensionSite
): Promise<{ files: TarFile[]; plugins: ManifestPlugin[] }> {
  const files: TarFile[] = []
  const plugins: ManifestPlugin[] = []
  for (const section of sections) {
    const seen = new Set<string>()
    try {
      for await (const entry of section.write(site)) {
        if (!ENTRY_PATH.test(entry.path) || seen.has(entry.path)) {
          throw new Error(`"${entry.path}" is not a path an archive may hold, or is repeated`)
        }
        seen.add(entry.path)
        const body = Buffer.from(entry.body)
        files.push({
          path: `${PLUGIN_SECTIONS_FOLDER}/${section.id}/${entry.path}`,
          bytes: body.length,
          body,
        })
      }
    } catch (error) {
      strapi.log.error(`micelio: the export section ${section.id} failed: ${String(error)}`)
      throw new ExportError('exportSectionFailed', `The export section "${section.id}" failed`)
    }
    if (section.personalData) {
      strapi.log.info(
        `micelio: exported the personal data of section "${section.id}" for site "${site.slug}"`
      )
    }
    plugins.push({
      id: section.id,
      version: section.version,
      personalData: section.personalData,
      entries: seen.size,
    })
  }
  return { files, plugins }
}

/**
 * Hands the sections of an archive to the plugins that registered them.
 *
 * @remarks
 * A section nobody registered, or of another major version than the registered one, is skipped
 * and reported, never an error. A `read` that throws is: the import's transaction rolls back.
 *
 * @throws `ExportError` `exportSectionFailed`.
 */
export async function readSections(
  strapi: Core.Strapi,
  archived: ManifestPlugin[],
  entriesOf: Map<string, ExportEntry[]>,
  site: ExtensionSite
): Promise<SectionsReport> {
  const registered = extensionsOf(strapi).exportSections()
  const report: SectionsReport = { sections: {}, skipped: [] }
  for (const plugin of archived) {
    const section = registered.find(({ id }) => id === plugin.id)
    if (!section) {
      report.skipped.push({ id: plugin.id, reason: 'unknown' })
    } else if (majorOf(section.version) !== majorOf(plugin.version)) {
      report.skipped.push({ id: plugin.id, reason: 'version' })
    } else {
      try {
        report.sections[plugin.id] = await section.read(site, entriesOf.get(plugin.id) ?? [])
      } catch (error) {
        strapi.log.error(`micelio: the import section ${plugin.id} failed: ${String(error)}`)
        throw new ExportError('exportSectionFailed', `The import section "${plugin.id}" failed`)
      }
    }
  }
  return report
}

function majorOf(version: string): string | undefined {
  return FORMAT_MAJOR.exec(version)?.[1]
}
