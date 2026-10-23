import type { Core } from '@strapi/strapi'
import { BLOCKS } from '../../../contract/blocks'
import { hooksOf } from '../hooks'
import type { BlockCatalogueChangedPayload } from '../types/hooks'
import {
  catalogueFingerprint,
  diffFingerprints,
  isCatalogueFingerprint,
  type CatalogueFingerprint,
} from '../utils/block-catalogue'

// Where the fingerprint of the last catalogue this instance booted with is kept: Strapi's own
// store (`strapi_core_store_settings`), not a content type.
const STORE = { type: 'plugin', name: 'micelio', key: 'block-catalogue' } as const

/**
 * Compares the catalogue with the one of the previous boot, saves it, and runs
 * `blockCatalogueChanged` when it changed.
 *
 * @remarks
 * With no fingerprint stored (a fresh instance, or one upgraded from before the catalogue), every
 * block is `added`. The fingerprint is saved before the handlers run, so a change is announced at
 * most once: a handler that fails is logged by `runAfter` and not called again on the next boot.
 *
 * @returns What changed; three empty lists when nothing did.
 */
export async function syncBlockCatalogue(
  strapi: Core.Strapi
): Promise<BlockCatalogueChangedPayload> {
  const current = catalogueFingerprint(BLOCKS)
  const diff = diffFingerprints(await storedFingerprint(strapi), current)
  if (!diff.added.length && !diff.changed.length && !diff.removed.length) return diff
  await strapi.store.set({ ...STORE, value: current })
  await hooksOf(strapi).runAfter('blockCatalogueChanged', diff)
  return diff
}

async function storedFingerprint(strapi: Core.Strapi): Promise<CatalogueFingerprint> {
  const stored = await strapi.store.get({ ...STORE })
  if (stored === null || stored === undefined) return {}
  if (isCatalogueFingerprint(stored)) return stored
  strapi.log.warn(
    'micelio: the stored block catalogue is not a fingerprint; every block counts as added'
  )
  return {}
}
