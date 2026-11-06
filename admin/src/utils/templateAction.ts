import { PLUGIN_ID } from '../pluginId'

/** The part of a content type's schema the create view's action reads. */
export interface ActionSchema {
  attributes?: Record<string, { type?: string } | undefined>
  pluginOptions?: { micelio?: { siteScoped?: unknown; pageSettings?: unknown } }
}

/**
 * Whether a page of this type can be made from a template: the type belongs to a site, was made
 * with `withPageSettings` and has a dynamic zone for the blocks.
 *
 * @remarks
 * The server's `hasPageSettings` applies the same rule. The Content Manager's schema leaves out the
 * attributes that record the template (`visible: false`), so the admin reads the plugin option.
 */
export function hasTemplates(schema: ActionSchema | undefined): boolean {
  return (
    schema?.pluginOptions?.micelio?.siteScoped === true &&
    schema.pluginOptions.micelio.pageSettings === true &&
    Object.values(schema.attributes ?? {}).some((attribute) => attribute?.type === 'dynamiczone')
  )
}

/** The admin path of the gallery of templates for a page type, which `TemplatesGalleryPage` reads (`new/:uid`). */
export function galleryPagePath(uid: string): string {
  return `/plugins/${PLUGIN_ID}/new/${encodeURIComponent(uid)}`
}
