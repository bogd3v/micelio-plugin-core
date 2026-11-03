import type { Core, Modules, UID } from '@strapi/strapi'
import { errors } from '@strapi/utils'
import { BLOCKS } from '../../../contract/blocks'
import { BlockOptionError } from '../block-options/error'
import type { PluginConfig } from '../config'
import { BLOCK_SETTING_UID } from '../constants/blocks'
import { SITE_UID } from '../constants/site'
import { isSiteScoped, SITE_ATTRIBUTE } from '../site-scope'
import { namedSites } from '../site-scope/documents'
import { assertBlocksAllowed } from './check'
import { BlockSettingError } from './error'
import { findSettingViolation, knownPageTypes } from './rules'

/** The actions that write `data`; `clone` takes it too (the Content Manager's duplicate). */
const CHECKED_ACTIONS: ReadonlySet<string> = new Set(['create', 'update', 'clone'])

type Params = Record<string, unknown> & {
  data?: Record<string, unknown>
  documentId?: string
  locale?: string
}

interface StoredRow {
  documentId: string
  slug?: string
  site?: { documentId: string; slug: string } | null
  [attribute: string]: unknown
}

/**
 * The document service middleware that enforces a site's settings of its blocks (ADR-0017,
 * section 4): a save that adds a block the site disabled or does not allow on the page's type is
 * refused with `blockNotAllowed`, and a write to the settings themselves is checked against the
 * contract.
 *
 * @remarks
 * Every write path of content goes through the document service: the REST routes, the admin, other
 * plugins, the import of a site archive and the Content Manager's duplicate (`clone`). On `create`,
 * `update` and `clone` of a site-scoped type it finds the catalogue blocks in the data wherever
 * they sit (dynamic zones, component attributes, parts) and refuses the first one the site's rules
 * forbid. Only an addition is refused (see `findBlockNotAllowed`): a page that already uses a
 * disabled block is saved as before. A `clone` is checked in full: the source's draft with `data`
 * laid over it, so a duplicate that names no blocks still copies none that are refused. An `update`
 * that moves a page to another site is checked in full against that site. Types with no site, and
 * data that names no block, are left alone.
 *
 * Writes to `plugin::micelio.block-setting` refuse a block the catalogue does not have, a default
 * outside the block's values (`blockOptionInvalid`), a page type or a label that names nothing
 * (`blockSettingInvalid`) and a second row for a block of the same site.
 *
 * @throws `BlockNotAllowedError`, {@link BlockOptionError} or {@link BlockSettingError}.
 */
export function blockSettingsDocuments(
  strapi: Core.Strapi
): Modules.Documents.Middleware.Middleware {
  const budgets = () => strapi.config.get<PluginConfig['budgets']>('plugin::micelio.budgets')

  // The site a write belongs to: the one it names, else the one the stored document (or the source
  // of a clone) has.
  async function siteOf(uid: UID.ContentType, params: Params): Promise<StoredRow['site']> {
    const named = params.data?.[SITE_ATTRIBUTE]
    const [documentId] = named === undefined ? [] : await namedSites(strapi, named)
    if (documentId !== undefined) {
      return (await strapi.db.query(SITE_UID as UID.ContentType).findOne({
        where: { documentId },
        select: ['documentId', 'slug'],
      })) as StoredRow['site']
    }
    return storedSiteOf(uid, params)
  }

  // The site a stored document belongs to now.
  async function storedSiteOf(uid: UID.ContentType, params: Params): Promise<StoredRow['site']> {
    if (!params.documentId) return null
    const row = (await strapi.db.query(uid).findOne({
      where: { documentId: params.documentId },
      populate: { [SITE_ATTRIBUTE]: { select: ['documentId', 'slug'] } },
    })) as StoredRow | null
    return row?.site ?? null
  }

  async function assertSettingValid(action: string, params: Params): Promise<void> {
    const uid = BLOCK_SETTING_UID as UID.ContentType
    const stored =
      action === 'update' && params.documentId
        ? ((await strapi.db.query(uid).findOne({
            where: { documentId: params.documentId },
            populate: { [SITE_ATTRIBUTE]: { select: ['documentId', 'slug'] } },
          })) as (StoredRow & { block?: string }) | null)
        : null
    const data = params.data ?? {}
    const blockId = String(data.block ?? stored?.block ?? '')
    const block = BLOCKS.find((candidate) => candidate.id === blockId)
    if (!block) throw new BlockSettingError('block', `The catalogue has no block "${blockId}"`)
    if (stored && data.block !== undefined && data.block !== stored.block) {
      throw new BlockSettingError('block', 'The block of a setting cannot change')
    }
    const site = stored?.site ?? (await siteOf(uid, params))
    const violation = findSettingViolation(
      data,
      block,
      knownPageTypes(budgets(), site?.slug ?? null)
    )
    if (violation?.kind === 'option') throw new BlockOptionError(violation.violation)
    if (violation) throw new BlockSettingError(violation.field, violation.detail)
    if (action === 'create' && site) {
      const same = await strapi.db.query(uid).count({
        where: { block: blockId, site: { documentId: site.documentId } },
      })
      if (same > 0) {
        throw new BlockSettingError(
          'block',
          `The site already has a setting for the ${blockId} block`
        )
      }
    }
  }

  return async (context, next) => {
    if (!CHECKED_ACTIONS.has(context.action)) return next()
    const params = context.params as Params
    if (context.uid === BLOCK_SETTING_UID) {
      if (context.action === 'clone') {
        throw new errors.ValidationError('A block setting cannot be cloned')
      }
      await assertSettingValid(context.action, params)
    } else if (isSiteScoped(strapi.contentType(context.uid))) {
      // A duplicate carries its source's blocks whatever `data` says, so a clone is always checked.
      const data = params.data ?? (context.action === 'clone' ? {} : undefined)
      const site = data ? await siteOf(context.uid, { ...params, data }) : null
      if (site && data) {
        const stored = context.action === 'update' ? await storedSiteOf(context.uid, params) : null
        await assertBlocksAllowed(strapi, {
          uid: context.uid,
          action: context.action as 'create' | 'update' | 'clone',
          movesSite: stored != null && stored.documentId !== site.documentId,
          site,
          documentId: params.documentId,
          locale: params.locale,
          data,
        })
      }
    }
    return next()
  }
}
