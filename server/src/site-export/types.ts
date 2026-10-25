// The archive of format 1.0 as the exporter writes it (`docs/export-format.md`).

/** A reference to another document of the archive. */
export interface DocumentRef {
  ref: string
  documentId: string
}

/** A reference to a media file of the archive, by its SHA-256. */
export interface MediaRef {
  media: string
}

/** A value of `data`, by the rules of the "Attributes" table. */
export type ExportValue =
  string | number | boolean | null | ExportValue[] | { [key: string]: ExportValue }

/** One locale and status of a document. */
export interface ExportVersion {
  locale: string | null
  status: 'draft' | 'published'
  createdAt: string | null
  updatedAt: string | null
  publishedAt: string | null
  data: Record<string, ExportValue>
}

/** One `documentId` with every version it has. */
export interface ExportDocument {
  documentId: string
  versions: ExportVersion[]
}

/** A content file: the documents of one export name. */
export interface ContentFile {
  type: string
  documents: ExportDocument[]
}

/** An entry of `media/index.json`. */
export interface MediaEntry {
  sha256: string
  name: string
  mime: string
  ext: string | null
  bytes: number
  width: number | null
  height: number | null
  alternativeText: string | null
  caption: string | null
  folderPath: string
}

/** An entry of `manifest.types`. */
export interface ManifestType {
  name: string
  uid: string
  file: string
  documents: number
}

/** The size and SHA-256 of a file of the archive. */
export interface FileDigest {
  sha256: string
  bytes: number
}

/** An entry of `manifest.plugins`: a section a sibling plugin added. */
export interface ManifestPlugin {
  id: string
  version: string
  personalData: boolean
  /** Files under `plugins/<id>/`. */
  entries: number
}

/** `manifest.json`. */
export interface Manifest {
  format: string
  formatVersion: string
  exportedAt: string
  generator: { name: string; version: string }
  micelio: string
  strapi: string
  site: { documentId: string; slug: string }
  locales: { code: string; name: string; isDefault: boolean }[]
  theme: { id: string; version: string | null; digest: string | null } | null
  fediverse: { actorId: string; handle: string } | null
  personal: boolean
  /** The sections of sibling plugins, by `id`; empty when none is registered. */
  plugins: ManifestPlugin[]
  types: ManifestType[]
  media: { file: string; count: number; bytes: number }
  files: Record<string, FileDigest>
}
