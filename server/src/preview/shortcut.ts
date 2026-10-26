import type { Core } from '@strapi/strapi'
import { isSiteScoped } from '../site-scope'

/** What Strapi hands the `admin.preview` handler: the entry its "Open preview" button was pressed on. */
interface PreviewHandlerParams {
  documentId?: string
  locale?: string
}

/**
 * The admin URL of the preview page for an entry, or `undefined` for a type that has no preview.
 *
 * @remarks
 * A collection type has one when it belongs to a site and has a dynamic zone, the same rule
 * the edit view's action follows. `undefined` makes Strapi answer `204`, and it shows no "Open preview" button.
 */
export function previewPageUrl(
  strapi: Core.Strapi,
  uid: string,
  { documentId, locale }: PreviewHandlerParams
): string | undefined {
  const schema = strapi.contentType(uid as never) as
    | { kind?: string; attributes?: Record<string, { type?: string }>; pluginOptions?: object }
    | undefined
  const hasDynamicZone = Object.values(schema?.attributes ?? {}).some(
    ({ type }) => type === 'dynamiczone'
  )
  if (!documentId || schema?.kind !== 'collectionType') return undefined
  if (!isSiteScoped(schema) || !hasDynamicZone) return undefined
  // `admin.url` is where the browser finds the admin: `/admin`, or the full URL when the server's
  // `url` carries a path prefix (`admin.path` is relative to the server and would lose it).
  const base = strapi.config.get('admin.url', '/admin') as string
  const page = `${base.replace(/\/$/, '')}/plugins/micelio/preview/${encodeURIComponent(uid)}/${encodeURIComponent(documentId)}`
  return locale ? `${page}?locale=${encodeURIComponent(locale)}` : page
}

/**
 * Points Strapi's own "Open preview" button at the plugin's preview page, unless the host has
 * configured `admin.preview` itself.
 *
 * @remarks
 * The host's `config/admin` wins, `enabled: false` included. Strapi reads the handler on each
 * request, so setting it while the plugin registers is early enough.
 */
export function registerPreviewShortcut(strapi: Core.Strapi): void {
  if (strapi.config.get('admin.preview') !== undefined) return
  strapi.config.set('admin.preview', {
    enabled: true,
    config: {
      handler: (uid: string, params: PreviewHandlerParams) => previewPageUrl(strapi, uid, params),
    },
  })
}
