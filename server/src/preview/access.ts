import type { Core, UID } from '@strapi/strapi'
import { SITE_ATTRIBUTE } from '../site-scope'

/** What decides whether an admin user may read a draft: the ability of their roles. */
export interface UserAbility {
  /** A plugin permission has no subject, so `can` takes the action alone. */
  can(action: string): boolean
}

interface PermissionChecker {
  cannot: Record<'read', (entity: object) => boolean>
}

interface DraftRow {
  locale?: string | null
  site?: { documentId: string } | null
}

/** The draft an admin user may read: its site and the locale of the version found. */
export interface ReadableDraft {
  siteDocumentId: string
  locale: string | null
}

/** Why a draft cannot be previewed, or the draft itself. */
export type DraftAccess =
  | { status: 'ok'; draft: ReadableDraft }
  | { status: 'missing' }
  | { status: 'forbidden' }
  | { status: 'not-site-scoped' }

/**
 * Finds a draft and checks that the abilities may read it, the way the Content Manager does.
 *
 * @remarks
 * `createdBy` is populated so that conditions such as `isCreator` apply. The locale found is the
 * one a request without `locale` resolves to, so the credential is bound to the draft shown.
 */
export async function readableDraft(
  strapi: Core.Strapi,
  userAbility: unknown,
  contentType: string,
  documentId: string,
  locale?: string | null
): Promise<DraftAccess> {
  const uid = contentType as UID.ContentType
  if (!strapi.contentType(uid)?.attributes?.[SITE_ATTRIBUTE]) return { status: 'not-site-scoped' }
  const entry = (await strapi.documents(uid).findOne({
    documentId,
    locale: locale ?? undefined,
    status: 'draft',
    populate: { [SITE_ATTRIBUTE]: { fields: ['documentId'] }, createdBy: true },
  } as never)) as DraftRow | null
  if (!entry?.site) return { status: 'missing' }
  const checker = strapi
    .plugin('content-manager')
    .service('permission-checker')
    .create({ userAbility, model: contentType }) as PermissionChecker
  if (checker.cannot.read(entry)) return { status: 'forbidden' }
  return {
    status: 'ok',
    draft: { siteDocumentId: entry.site.documentId, locale: entry.locale ?? null },
  }
}

/**
 * The abilities of an admin user as they are now, or `null` when the user is gone or inactive.
 *
 * @remarks
 * Read again at every exchange and every draft request, so a role that lost its permissions
 * stops working at once.
 */
export async function abilityOf(strapi: Core.Strapi, adminUser: number): Promise<unknown> {
  const user = (await strapi.db
    .query('admin::user')
    .findOne({ where: { id: adminUser }, populate: ['roles'] })) as { isActive?: boolean } | null
  if (!user || user.isActive === false) return null
  return strapi.service('admin::permission').engine.generateUserAbility(user)
}
