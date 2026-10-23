import type { Core, UID } from '@strapi/strapi'
import { EDITORIAL_ATTRIBUTE } from '../constants/editorial'
import { isEditorial } from '.'
import { performTransition } from './transitions'

/** Name of the cron job that publishes scheduled entries. */
export const SCHEDULER_JOB = 'micelio-publish-scheduled'

/**
 * Publishes every `scheduled` entry whose `publishAt` has passed, in every editorial type.
 *
 * @remarks
 * Each entry goes through the `scheduled -> published` transition as the plugin itself, so the
 * guard and the bookkeeping are those of any transition. An entry that fails is logged and left
 * scheduled for the next run; it does not stop the others.
 *
 * @param now - The moment that counts as "passed"; the current time by default.
 * @returns How many entries were published.
 */
export async function publishDueEntries(strapi: Core.Strapi, now = new Date()): Promise<number> {
  let published = 0
  for (const uid of Object.keys(strapi.contentTypes) as UID.ContentType[]) {
    if (!isEditorial(strapi.contentType(uid))) continue
    // Draft rows only: the editorial state lives on the draft.
    const due = (await strapi.db.query(uid).findMany({
      select: ['documentId', 'locale'],
      where: {
        publishedAt: null,
        [EDITORIAL_ATTRIBUTE]: { state: 'scheduled', publishAt: { $lte: now } },
      },
    })) as { documentId: string; locale?: string | null }[]
    for (const entry of due) {
      try {
        await performTransition(strapi, {
          uid,
          documentId: entry.documentId,
          locale: entry.locale ?? undefined,
          to: 'published',
          actor: { kind: 'system' },
        })
        published += 1
      } catch (error) {
        strapi.log.error(
          `micelio: could not publish scheduled entry ${uid} ${entry.documentId}: ${String(error)}`
        )
      }
    }
  }
  return published
}

/**
 * Registers the cron job that runs {@link publishDueEntries} on `scheduledPublishRule`.
 *
 * @remarks
 * Nothing is registered when the rule is `false`. A run that starts while the previous one is
 * still going is skipped.
 *
 * @returns Whether the job was registered.
 */
export function registerScheduler(strapi: Core.Strapi): boolean {
  const rule = strapi.config.get<string | false>('plugin::micelio.scheduledPublishRule')
  if (rule === false) {
    strapi.log.info('micelio: the scheduler is off (scheduledPublishRule: false)')
    return false
  }
  let running = false
  strapi.cron.add({
    [SCHEDULER_JOB]: {
      async task() {
        if (running) return
        running = true
        try {
          await publishDueEntries(strapi)
        } finally {
          running = false
        }
      },
      options: { rule },
    },
  })
  return true
}
