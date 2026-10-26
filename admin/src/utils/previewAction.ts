import { PLUGIN_ID } from '../pluginId'

/** The part of a content type's schema the edit view's action reads. */
export interface ActionSchema {
  attributes?: Record<string, { type?: string } | undefined>
  pluginOptions?: { micelio?: { siteScoped?: unknown } }
}

/**
 * Whether an entry of this type has a preview: the type belongs to a site (`withSiteScope`) and has
 * a dynamic zone, which is where the blocks of a page live.
 *
 * @remarks
 * The server's handler for Strapi's own "Open preview" button (`server/src/preview/shortcut.ts`)
 * applies the same rule; the two stay apart because the admin imports nothing at runtime from the server.
 */
export function hasPreview(schema: ActionSchema | undefined): boolean {
  if (schema?.pluginOptions?.micelio?.siteScoped !== true) return false
  return Object.values(schema.attributes ?? {}).some(
    (attribute) => attribute?.type === 'dynamiczone'
  )
}

/** The admin path of the preview page for an entry, which `PreviewPage` reads (`preview/:uid/:documentId`). */
export function previewPagePath(uid: string, documentId: string, locale: string | null): string {
  const page = `/plugins/${PLUGIN_ID}/preview/${encodeURIComponent(uid)}/${encodeURIComponent(documentId)}`
  return locale ? `${page}?locale=${encodeURIComponent(locale)}` : page
}
