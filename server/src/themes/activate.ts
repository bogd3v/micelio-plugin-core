import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '../constants/site'
import { THEME_ACTIVATION_UID } from '../constants/themes'
import type { ThemeActivationAnswer, ThemePin } from '../types/themes'
import { readFrontendThemes, readThemeSite, revertTarget, type ThemeSite } from './read'
import { isPinInstalled, pinFrom, planActivation } from './rules'

/** Why an activation or a revert wrote nothing; `code` is the problem's, `status` its HTTP status. */
export class ThemeChangeError extends Error {
  constructor(
    readonly code:
      | 'themeSiteNotFound'
      | 'themesFrontendUnavailable'
      | 'themeRebuildRequired'
      | 'themeUnknown'
      | 'themeRevertUnavailable',
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'ThemeChangeError'
  }
}

/**
 * Activates a theme on a site: writes its pin to the site's `theme` component and logs the change.
 *
 * @remarks
 * Reads the frontend's status and catalogue first, and writes what {@link planActivation} decides:
 * the id alone for a theme the image was built with, the id, version and digest for a data-only
 * theme the frontend installs at runtime (ADR-0009 of `micelio`, section 3). Writes a row of
 * `plugin::micelio.theme-activation` and one `info` line. The frontend switches on its own; the
 * caller reads its status to see the result.
 *
 * @throws {@link ThemeChangeError} `themeSiteNotFound` (404), `themesFrontendUnavailable` (502) when the
 * frontend did not answer its status, `themeRebuildRequired` (409) for a code theme the image was not
 * built with (ADR-0009, section 4), `themeUnknown` (404) for a theme the frontend does not know. Each
 * writes nothing.
 */
export async function activateTheme(
  strapi: Core.Strapi,
  request: { site: string | null; id: string; version?: string },
  adminUserId: number | null
): Promise<ThemeActivationAnswer> {
  const site = await requireSite(strapi, request.site)
  const { status, catalogue } = await readFrontendThemes(site.origin)
  if (!status) throw unavailable(site)
  const plan = planActivation({ id: request.id, version: request.version }, status, catalogue)
  if (plan.kind === 'rebuild') {
    throw new ThemeChangeError(
      'themeRebuildRequired',
      409,
      `${request.id} ships code the frontend's image was not built with: it activates only on an image built with it.`
    )
  }
  if (plan.kind === 'unknown') {
    throw new ThemeChangeError(
      'themeUnknown',
      404,
      `The frontend of ${site.slug} holds no theme ${request.id}${request.version ? ` at ${request.version}` : ''} it can activate.`
    )
  }
  return writePin(strapi, site, plan.pin, 'activate', adminUserId)
}

/**
 * Writes back the pin the last activation of a site replaced, and logs the change.
 *
 * @throws {@link ThemeChangeError} `themeSiteNotFound` (404), `themesFrontendUnavailable` (502),
 * `themeRevertUnavailable` (409) when there is no activation to revert (none, the last change was a
 * revert, or the pin changed since) or the frontend no longer holds that theme. Each writes nothing.
 */
export async function revertTheme(
  strapi: Core.Strapi,
  request: { site: string | null },
  adminUserId: number | null
): Promise<ThemeActivationAnswer> {
  const site = await requireSite(strapi, request.site)
  const target = await revertTarget(strapi, site, pinFrom(site.theme))
  if (!target) {
    throw new ThemeChangeError(
      'themeRevertUnavailable',
      409,
      `The pin of ${site.slug} was not changed by an activation it could revert.`
    )
  }
  const { status } = await readFrontendThemes(site.origin)
  if (!status) throw unavailable(site)
  if (!isPinInstalled(target, status)) {
    throw new ThemeChangeError(
      'themeRevertUnavailable',
      409,
      `The frontend of ${site.slug} no longer holds ${target.themeId ?? 'the theme'} the last activation replaced.`
    )
  }
  return writePin(strapi, site, target, 'revert', adminUserId)
}

async function requireSite(strapi: Core.Strapi, slug: string | null): Promise<ThemeSite> {
  const site = await readThemeSite(strapi, slug)
  if (!site) throw new ThemeChangeError('themeSiteNotFound', 404, `There is no site "${slug}".`)
  return site
}

function unavailable(site: ThemeSite): ThemeChangeError {
  return new ThemeChangeError(
    'themesFrontendUnavailable',
    502,
    `The frontend of ${site.slug} did not answer its theme status.`
  )
}

/** Writes `pin` to the site's `theme` component, keeping its other fields, then the log row and line. */
async function writePin(
  strapi: Core.Strapi,
  site: ThemeSite,
  pin: ThemePin,
  action: 'activate' | 'revert',
  adminUserId: number | null
): Promise<ThemeActivationAnswer> {
  const before = pinFrom(site.theme)
  const { accentOverrides, ...rest } = withoutId(site.theme ?? {})
  await strapi.documents(SITE_UID as UID.ContentType).update({
    documentId: site.documentId,
    ...(site.locale ? { locale: site.locale } : {}),
    data: {
      theme: {
        ...rest,
        ...pin,
        // A component is written again from its values; the ids are the old rows'.
        accentOverrides: Array.isArray(accentOverrides)
          ? accentOverrides.map((override: Record<string, unknown>) => withoutId(override))
          : [],
      },
    } as never,
  })
  await strapi.db.query(THEME_ACTIVATION_UID as UID.ContentType).create({
    data: { action, pinBefore: before, pinAfter: pin, adminUserId, site: site.id },
  })
  strapi.log.info(
    `[micelio] ${action === 'activate' ? 'activated' : 'reverted to'} ${describe(pin)} on site ${site.slug} (was ${describe(before)}), admin user ${adminUserId ?? 'unknown'}`
  )
  return { site: site.slug, before, after: pin }
}

function withoutId(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id'))
}

function describe(pin: ThemePin): string {
  if (!pin.themeId) return 'the default theme'
  return `theme ${pin.themeVersion ? `${pin.themeId}@${pin.themeVersion}` : pin.themeId}`
}
