import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'
import { exportedTypes, documentsOf, siteRowsOf } from '../site-export/model'
import type { Attributes, StoredFile } from '../site-export/serialise'
import type { TransferOptions } from '../types/transfer'

/** The counts the Export and import page shows before an export: what a default export would hold. */
export type SiteCounts = Pick<
  TransferOptions,
  'entries' | 'mediaFiles' | 'mediaBytes' | 'estimatedBytes' | 'hasPersonalTypes'
>

/**
 * Counts what an export of a site holds without personal data, without reading a media file.
 *
 * @remarks
 * The archive's size is an estimate: the JSON of the documents plus the size the library records
 * for each file, before compression.
 *
 * @returns `null` when no site has the slug.
 */
export async function countSite(strapi: Core.Strapi, slug: string): Promise<SiteCounts | null> {
  const sites = (await strapi.db.query(SITE_UID as UID.ContentType).findMany({
    where: { slug },
    select: ['documentId'],
  })) as { documentId: string }[]
  if (!sites[0]) return null
  const types = exportedTypes(strapi, false)
  const names = new Map(types.map((type) => [type.uid, type.name]))
  const files = new Map<number, number>()
  const context = {
    componentAttributes: (uid: string) =>
      (strapi.components[uid as UID.Component]?.attributes ?? {}) as Attributes,
    exportNameOf: (uid: string) => names.get(uid),
    mediaRef(file: StoredFile) {
      // The library records the size in kB.
      files.set(file.id, Math.round(Number(file.size ?? 0) * 1024))
      return { media: '' }
    },
    personal: false,
  }
  let entries = 0
  let jsonBytes = 0
  for (const type of types) {
    if (type.uid === SITE_UID) continue
    const documents = documentsOf(type, await siteRowsOf(strapi, type, sites[0], context), context)
    entries += documents.length
    jsonBytes += JSON.stringify(documents).length
  }
  const mediaBytes = [...files.values()].reduce((sum, bytes) => sum + bytes, 0)
  return {
    entries,
    mediaFiles: files.size,
    mediaBytes,
    estimatedBytes: jsonBytes + mediaBytes,
    hasPersonalTypes: exportedTypes(strapi, true).length > types.length,
  }
}
