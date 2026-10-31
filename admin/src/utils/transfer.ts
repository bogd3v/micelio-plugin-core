import type { ImportPreview, ImportPreviewType } from '../../../server/src/site-export/dry-run'

const UNITS = ['B', 'kB', 'MB', 'GB']

/** A size in bytes as people read it: `1.5 MB`, with the decimal point of `locale`. */
export function formatBytes(bytes: number, locale = 'en'): string {
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${UNITS[unit]}`
}

/** What an export export name is called in a table: `long-read` is `Long read`. */
export function kindLabel(name: string): string {
  const text = name.replace(/-/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** One row of the dry run's table, other than the site, the media and the theme pin. */
export interface PreviewRow extends ImportPreviewType {
  name: string
}

/** The content rows of a preview, in the order the server gave them, without the site's own. */
export function contentRows(preview: ImportPreview): PreviewRow[] {
  return Object.entries(preview.types)
    .filter(([name]) => name !== 'site')
    .map(([name, counts]) => ({ name, ...counts }))
}

/**
 * How many items "Import" would write: the documents it creates or updates, plus the media it
 * would store.
 */
export function itemsToImport(preview: ImportPreview): number {
  const documents = Object.values(preview.types).reduce(
    (sum, counts) => sum + counts.create + counts.update,
    0
  )
  return documents + (preview.media.inFile - preview.media.reused)
}

/** A warning of the dry run, as a message `id` of the translations and its values. */
export interface PreviewWarning {
  id: string
  values: Record<string, string | number>
}

/** The warnings a dry run carries: what an import would leave out or ignore. */
export function warningsOf(preview: ImportPreview): PreviewWarning[] {
  const warnings: PreviewWarning[] = []
  const asDraft = Object.values(preview.types).reduce((sum, counts) => sum + counts.asDraft, 0)
  if (asDraft > 0) {
    warnings.push({ id: 'transfer.warning.asDraft', values: { count: asDraft } })
  }
  if (preview.missingReferences > 0) {
    warnings.push({
      id: 'transfer.warning.missingReferences',
      values: { count: preview.missingReferences },
    })
  }
  if (preview.unknownTypes.length > 0) {
    warnings.push({
      id: 'transfer.warning.unknownTypes',
      values: { names: preview.unknownTypes.join(', ') },
    })
  }
  if (preview.unknownRoles.length > 0) {
    warnings.push({
      id: 'transfer.warning.unknownRoles',
      values: { roles: preview.unknownRoles.join(', ') },
    })
  }
  if (preview.skippedPlugins.length > 0) {
    warnings.push({
      id: 'transfer.warning.skippedPlugins',
      values: { ids: preview.skippedPlugins.join(', ') },
    })
  }
  return warnings
}
