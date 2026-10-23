// The content types of an archive and their documents, as the exporter writes them and the
// importer compares them with what the target holds.
import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'
import { isSiteScoped, SITE_ATTRIBUTE } from '../site-scope'
import { exportNameOf, exportPolicyOf, isWritten } from './names'
import {
  populateOf,
  serialiseData,
  toTimestamp,
  type Attributes,
  type SerialiseContext,
} from './serialise'
import type { ExportDocument, ExportVersion } from './types'

/** A content type an archive holds, with its export name. */
export interface ExportedType {
  uid: string
  name: string
  attributes: Attributes
  isLocalized: boolean
  hasDrafts: boolean
}

/** A stored row of a document, as `strapi.db.query` answers it. */
export type Row = Record<string, unknown> & { documentId: string; locale?: string | null }

/**
 * The site type and every site-scoped type the archive writes, in byte order of export name.
 *
 * @param personal - Whether to count the types an archive writes only with personal data.
 */
export function exportedTypes(strapi: Core.Strapi, personal: boolean): ExportedType[] {
  const types: ExportedType[] = []
  for (const [uid, schema] of Object.entries(strapi.contentTypes)) {
    if (uid !== SITE_UID && !isSiteScoped(schema)) continue
    if (!isWritten(exportPolicyOf(schema as never), personal)) continue
    types.push({
      uid,
      name: exportNameOf(uid, schema as never),
      attributes: attributesOf(strapi, uid),
      isLocalized:
        strapi.plugin('i18n')?.service('content-types').isLocalizedContentType(schema) === true,
      hasDrafts: schema.options?.draftAndPublish === true,
    })
  }
  return types.sort((a, b) => compare(a.name, b.name))
}

/**
 * Every row of the documents of a type that belong to a site.
 *
 * @remarks
 * A document belongs to the site when one of its rows does: a row in a locale the site itself
 * lacks can be stored without the relation.
 */
export async function siteRowsOf(
  strapi: Core.Strapi,
  type: ExportedType,
  site: { documentId: string },
  context: SerialiseContext
): Promise<Row[]> {
  const query = strapi.db.query(type.uid as UID.ContentType)
  const owned = (await query.findMany({
    select: ['documentId'],
    where: { [SITE_ATTRIBUTE]: { documentId: site.documentId } },
  })) as Row[]
  const documentIds = [...new Set(owned.map((row) => row.documentId))]
  if (documentIds.length === 0) return []
  return (await query.findMany({
    where: { documentId: { $in: documentIds } },
    populate: populateOf(type.attributes, context, new Set([SITE_ATTRIBUTE])),
  })) as Row[]
}

/** The attributes of a content type as the loaded schema holds them. */
export function attributesOf(strapi: Core.Strapi, uid: string): Attributes {
  return strapi.contentType(uid as UID.ContentType).attributes as unknown as Attributes
}

/** The documents of an archive's content file, from the stored rows of their versions. */
export function documentsOf(
  type: ExportedType,
  rows: Row[],
  context: SerialiseContext
): ExportDocument[] {
  const skip = new Set(type.uid === SITE_UID ? [] : [SITE_ATTRIBUTE])
  const documents = new Map<string, ExportVersion[]>()
  for (const row of rows) {
    const version: ExportVersion = {
      locale: type.isLocalized ? (row.locale ?? null) : null,
      status: type.hasDrafts && !row.publishedAt ? 'draft' : 'published',
      createdAt: toTimestamp(row.createdAt),
      updatedAt: toTimestamp(row.updatedAt),
      publishedAt: toTimestamp(row.publishedAt),
      data: serialiseData(type.attributes, row, context, skip),
    }
    documents.set(row.documentId, [...(documents.get(row.documentId) ?? []), version])
  }
  return [...documents.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([documentId, versions]) => ({
      documentId,
      versions: versions.sort(
        (a, b) => compare(a.locale ?? '', b.locale ?? '') || compare(a.status, b.status)
      ),
    }))
}

/** Byte order of UTF-8, which for the ASCII of the archive is code unit order. */
export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
