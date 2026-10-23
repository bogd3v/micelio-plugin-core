import type { Readable, Writable } from 'node:stream'
import type { Core } from '@strapi/strapi'
import { exportSite, type ExportRequest } from '../site-export/exporter'
import { importSite, type ImportReport, type ImportRequest } from '../site-export/importer'
import type { Manifest } from '../site-export/types'

/**
 * The `siteExport` service: `strapi.plugin('micelio').service('siteExport')`.
 *
 * @remarks
 * Writes and reads the site archive of `docs/export-format.md`. It refuses with an `ExportError`,
 * whose `code` is one of the specification's.
 */
export interface SiteExportService {
  /** Writes the archive of a site to `output` and answers its manifest; see `exportSite`. */
  export(request: ExportRequest, output: Writable): Promise<Manifest>
  /** Imports the archive `source` reads and answers what it did; see `importSite`. */
  import(source: Readable, request?: ImportRequest): Promise<ImportReport>
}

export default ({ strapi }: { strapi: Core.Strapi }): SiteExportService => ({
  export(request, output) {
    return exportSite(strapi, request, output)
  },
  import(source, request) {
    return importSite(strapi, source, request)
  },
})
