import type { Core } from '@strapi/strapi'
import { STATUS_REFRESH_JOB } from '../constants/extensions'

/**
 * Registers the cron job that runs the host check and the plugins' checks on `statusRefreshRule`.
 *
 * @remarks
 * Nothing is registered when the rule is `false`. The run is the one "Run again" starts, so a
 * run already in progress is shared, not repeated. A failure is logged.
 *
 * @returns Whether the job was registered.
 */
export function registerStatusRefresh(strapi: Core.Strapi): boolean {
  const rule = strapi.config.get<string | false>('plugin::micelio.statusRefreshRule')
  if (rule === false) return false
  strapi.cron.add({
    [STATUS_REFRESH_JOB]: {
      async task() {
        try {
          await strapi.plugin('micelio').service('status').runHostCheck()
        } catch (error) {
          strapi.log.error(`micelio: the daily status refresh failed: ${String(error)}`)
        }
        try {
          await strapi.plugin('micelio').service('about').refresh({ force: true })
        } catch (error) {
          strapi.log.error(`micelio: the daily About refresh failed: ${String(error)}`)
        }
      },
      options: { rule },
    },
  })
  return true
}
