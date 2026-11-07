import { AsyncLocalStorage } from 'node:async_hooks'
import type { Core, Modules, UID } from '@strapi/strapi'
import { TEMPLATE_FIXED_ATTRIBUTE } from '../constants/page-settings'
import { hasPageSettings } from '../page-settings'
import type { FixedMark } from '../types/page-templates'
import { findFixedViolation, followFixed } from './changes'
import { FixedBlockError } from './error'

const own = new AsyncLocalStorage<true>()

/**
 * Runs a write of the plugin's own that may change the fixed blocks (applying an offer, switching,
 * detaching, restoring a page from a site archive), so the middleware lets it through.
 *
 * @remarks
 * The allowance is the call's context, never a key of the data: `templateFixed` can be sent by a
 * client, the context cannot.
 */
export function asTemplateWrite<T>(run: () => Promise<T>): Promise<T> {
  return own.run(true, run)
}

type Params = Record<string, unknown> & { data?: Record<string, unknown>; documentId?: string }

/**
 * The document service middleware that keeps the blocks a page's template fixed: an `update` that
 * removes one, or reorders the fixed blocks, is refused with {@link FixedBlockError}.
 *
 * @remarks
 * It reads the stored draft only for a page type made with `withPageSettings` and only when the data
 * names a dynamic zone. A write made inside {@link asTemplateWrite} (applying an offer, switching,
 * detaching, an import of a site archive) is the template's own and is not checked. Naming
 * `templateFixed` in the data lifts nothing.
 */
export function templateFixedDocuments(
  strapi: Core.Strapi
): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    const params = context.params as Params
    const { data, documentId } = params
    if (context.action !== 'update' || !data || !documentId || own.getStore()) return next()
    const model = strapi.contentType(context.uid as UID.ContentType)
    if (!hasPageSettings(model)) return next()
    const zones = Object.entries(model.attributes as Record<string, { type?: string }>)
      .filter(([name, attribute]) => attribute.type === 'dynamiczone' && Array.isArray(data[name]))
      .map(([name]) => name)
    if (zones.length === 0) return next()
    const stored = (await strapi.documents(context.uid as UID.ContentType).findOne({
      documentId,
      locale: params.locale as string | undefined,
      status: 'draft',
      populate: Object.fromEntries(zones.map((name) => [name, true])),
    } as never)) as Record<string, unknown> | null
    const marks = stored?.[TEMPLATE_FIXED_ATTRIBUTE]
    if (!Array.isArray(marks) || marks.length === 0) return next()
    let followed = marks as FixedMark[]
    for (const name of zones) {
      const violation = findFixedViolation(
        (stored?.[name] as Record<string, unknown>[] | undefined) ?? [],
        data[name] as Record<string, unknown>[],
        marks as FixedMark[]
      )
      if (violation) throw new FixedBlockError(violation)
      followed = followFixed(
        (stored?.[name] as Record<string, unknown>[] | undefined) ?? [],
        data[name] as Record<string, unknown>[],
        followed
      )
    }
    // A mark names the nth block of its type: when the edit shifts that, the mark moves with its block.
    if (JSON.stringify(followed) !== JSON.stringify(marks)) {
      params.data = { ...data, [TEMPLATE_FIXED_ATTRIBUTE]: followed }
    }
    return next()
  }
}
