// The "keep both" policy of an import: the archive's documents become new documents of the target.
import { createHash } from 'node:crypto'
import type { StagedArchive } from './archive'
import type { ContentFile, ExportValue } from './types'

const SITE_NAME = 'site'

/**
 * The archive with every document under a `documentId` of its own on the target, and every
 * reference to one rewritten to match.
 *
 * @remarks
 * The new id is derived from the target's site, the export name and the archive's id, so that the
 * same archive imported into the same site again finds its copies and writes nothing (the import
 * stays idempotent), and imported into another site makes copies of its own. The archive's site
 * stands for the target's site. A reference to a document the archive does not hold is left as it is.
 */
export function keepBoth(staged: StagedArchive, site: { documentId: string }): StagedArchive {
  const ids = new Map<string, string>()
  for (const [name, content] of staged.contents) {
    for (const document of content.documents) {
      ids.set(
        `${name}:${document.documentId}`,
        derivedId(site.documentId, name, document.documentId)
      )
    }
  }
  const archived = staged.contents.get(SITE_NAME)?.documents[0]
  if (archived) ids.set(`${SITE_NAME}:${archived.documentId}`, site.documentId)

  const contents = new Map<string, ContentFile>()
  for (const [name, content] of staged.contents) {
    contents.set(name, {
      ...content,
      documents: content.documents.map((document) => ({
        documentId: ids.get(`${name}:${document.documentId}`) ?? document.documentId,
        versions: document.versions.map((version) => ({
          ...version,
          data: rewrite(version.data, ids) as typeof version.data,
        })),
      })),
    })
  }
  return { ...staged, contents }
}

// Strapi's own ids are 24 characters of lower case letters and digits; so is this.
function derivedId(site: string, name: string, documentId: string): string {
  return createHash('sha256').update(`${site}:${name}:${documentId}`).digest('hex').slice(0, 24)
}

function rewrite(value: ExportValue, ids: Map<string, string>): ExportValue {
  if (Array.isArray(value)) return value.map((item) => rewrite(item, ids))
  if (value === null || typeof value !== 'object') return value
  const { ref, documentId } = value as { ref?: unknown; documentId?: unknown }
  if (typeof ref === 'string' && typeof documentId === 'string') {
    return { ...value, documentId: ids.get(`${ref}:${documentId}`) ?? documentId }
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item, ids)]))
}
