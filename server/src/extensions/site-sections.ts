import type { Core, Modules, UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'
import { extensionsOf } from '.'

type Params = Record<string, unknown> & { data?: Record<string, unknown> }

const SITE = SITE_UID as UID.ContentType

/**
 * The document service middleware that gives a new site an instance of every site section.
 *
 * @remarks
 * A section the creator supplied is kept. An empty instance is valid because a plugin's component
 * has defaults for every attribute it needs.
 */
export function siteSectionInstances(strapi: Core.Strapi): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    if (context.uid === SITE && context.action === 'create') {
      const params = context.params as Params
      const data = (params.data ??= {})
      for (const { id } of extensionsOf(strapi).siteSections()) {
        data[extensionsOf(strapi).siteSectionAttribute(id)] ??= {}
      }
    }
    return next()
  }
}

/**
 * Gives every site that has none an instance of each site section, once per boot.
 *
 * @remarks
 * Idempotent: a site with an instance is left alone. It covers the sites created before a plugin
 * registered its section. Only the default locale's row is written; Strapi copies a
 * non-localised attribute to the other locales.
 *
 * @returns How many instances it created.
 */
export async function ensureSiteSections(strapi: Core.Strapi): Promise<number> {
  const locales = strapi.plugin('i18n').service('locales') as {
    getDefaultLocale: () => Promise<string>
  }
  const defaultLocale = await locales.getDefaultLocale()
  let created = 0
  for (const { id } of extensionsOf(strapi).siteSections()) {
    const attribute = extensionsOf(strapi).siteSectionAttribute(id)
    const rows = (await strapi.db.query(SITE).findMany({
      select: ['documentId', 'locale'],
      where: { locale: defaultLocale },
      populate: { [attribute]: true },
    })) as ({ documentId: string; locale: string } & Record<string, unknown>)[]
    for (const row of rows.filter((candidate) => !candidate[attribute])) {
      await strapi.documents(SITE).update({
        documentId: row.documentId,
        locale: row.locale,
        data: { [attribute]: {} },
      })
      created += 1
    }
  }
  return created
}
