import type { Core, Modules } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'
import { hooksOf } from '../hooks'

/** The document service middleware that runs the `siteCreated` hook after a site is created. */
export function siteCreatedHook(strapi: Core.Strapi): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    const result = await next()
    if (context.uid !== SITE_UID || context.action !== 'create') return result
    const site = result as unknown as {
      documentId: string
      slug: string
      isDefault?: boolean | null
    }
    await hooksOf(strapi).runAfter('siteCreated', {
      site: site.documentId,
      slug: site.slug,
      isDefault: site.isDefault === true,
    })
    return result
  }
}
