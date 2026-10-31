import type { LocalisedText } from './extensions'
import type { ImportPreview } from '../site-export/dry-run'
import type { ExportScope } from '../site-export/exporter'
import type { ImportReport, ExistingPolicy } from '../site-export/importer'

/** What an export asks for, as `POST /micelio/exports` takes it. */
export interface ExportOptions {
  /** The `slug` of the site. */
  site: string
  scope: Required<ExportScope>
  /** Whether the archive holds the personal data the site does not show; needs the personal permission. */
  personal: boolean
  /** The `id` of every sibling plugin's section with personal data to include. */
  include: string[]
}

/** A row of the history of the Export and import page, as the routes answer it. */
export interface TransferRecord {
  id: number
  kind: 'export' | 'import'
  /**
   * An export is `queued`, `running`, then `ready` or `failed`; an import is `staged` after its
   * dry run, then `applied` or `failed`.
   */
  status: 'queued' | 'running' | 'ready' | 'failed' | 'staged' | 'applied'
  siteSlug: string
  /** The name of the archive: written for an export, uploaded for an import. */
  name: string
  /** The admin user who asked, by name. */
  operator: string | null
  /** An export: the archive size in bytes once `ready`; an import: the size of the file. */
  bytes: number | null
  /** When the file stops being available: 24 hours after the export was made. */
  expiresAt: string
  /** Whether the file can still be downloaded. */
  isAvailable: boolean
  /**
   * The unguessable part of the download address of a ready export. Only the admin user who made
   * the export is given it; `null` for everyone else, and for an import.
   */
  downloadToken: string | null
  createdAt: string
  /** What went wrong, for `failed`: a code and a sentence. */
  error: string | null
  /** An export: what it held. An import: the dry run and, once applied, the report. */
  details: ExportDetails | ImportDetails | null
}

/** What a finished export held. */
export interface ExportDetails {
  scope: ExportOptions['scope']
  personal: boolean
  /** The `id` of the personal sections the archive holds. */
  include: string[]
  documents: number
  mediaFiles: number
}

/** The dry run of a staged import, and the report once it is applied. */
export interface ImportDetails {
  existing: ExistingPolicy
  preview: ImportPreview | null
  report: ImportReport | null
  /**
   * Set instead of `preview` when the archive's documents belong to another site of this CMS and
   * the policy is not `keep-both`: the sentence that names the first one.
   */
  conflict?: string
}

/** What the page shows before an export: the counts of one site, and the sections it may add. */
export interface TransferOptions {
  /** Distinct documents of the site's content types, without the site itself. */
  entries: number
  mediaFiles: number
  mediaBytes: number
  /** The archive's size, estimated from its content and media. */
  estimatedBytes: number
  /** The personal sections sibling plugins registered, which the caller's permissions allow. */
  sections: { id: string; label: LocalisedText | string }[]
  /** Whether the caller may include personal data. */
  canIncludePersonal: boolean
  /** Whether the site has types that declare personal data. */
  hasPersonalTypes: boolean
}
