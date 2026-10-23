import type { Core, UID } from '@strapi/strapi'
import { DEFAULT_SITE_SLUG, SITE_UID } from '../constants/site'

/** Locales the `defaultLocale` field accepts; the same list as `site-setting` in `micelio-cms`. */
const SITE_LOCALES = ['en', 'es']

/**
 * Creates the default site when there is no site at all, in Strapi's default locale.
 *
 * @remarks
 * The site is neutral (principle 2 of the standard): the product's name, no URL, no host names
 * and every module on. Afterwards the admin panel owns it: an existing site is never touched.
 *
 * @returns Whether a site was created.
 */
export async function ensureDefaultSite(strapi: Core.Strapi): Promise<boolean> {
  if ((await strapi.db.query(SITE_UID).count()) > 0) return false

  const locales = strapi.plugin('i18n').service('locales') as {
    getDefaultLocale: () => Promise<string>
  }
  const locale = await locales.getDefaultLocale()
  await strapi.documents(SITE_UID as UID.ContentType).create({
    locale,
    data: {
      name: 'Micelio',
      slug: DEFAULT_SITE_SLUG,
      hosts: [],
      isDefault: true,
      defaultLocale: SITE_LOCALES.includes(locale) ? locale : 'en',
      // Every module defaults to on.
      modules: {},
    },
  })
  return true
}
