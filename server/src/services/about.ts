import type { Core } from '@strapi/strapi'
import { readAbout, runAboutChecks, type AboutChecks } from '../about/read'
import type { AboutReport } from '../types/about'

const FEED_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** The `about` service: `strapi.plugin('micelio').service('about')`, behind the About page. */
export interface AboutService {
  /** What the About page shows; makes no request. */
  read(): Promise<AboutReport>
  /**
   * Asks each site's frontend for `/_health` and reads the release feed, and keeps the answers
   * for `read`. The feed is read only while `MICELIO_UPDATE_CHECK` is not `false`.
   *
   * @remarks
   * Run at boot, once a day by the status refresh job, and by "Run checks again". Never by a page
   * load. One run at a time: a call made while a run is in progress answers that run. The feed is
   * read at most once in 24 hours: "Run checks again" asks the frontends again and keeps the feed's
   * last answer, and only the daily job (`force`) reads the feed whatever its age.
   */
  refresh(options?: { force?: boolean }): Promise<AboutReport>
}

export default ({ strapi }: { strapi: Core.Strapi }): AboutService => {
  let checks: AboutChecks | undefined
  let feedReadAt = 0
  let running: Promise<AboutChecks> | undefined

  const runOnce = async (force: boolean): Promise<AboutChecks> => {
    try {
      const isFresh =
        !force &&
        checks !== undefined &&
        checks.update.state !== 'off' &&
        Date.now() - feedReadAt < FEED_MAX_AGE_MS
      const result = await runAboutChecks(strapi, isFresh ? checks?.update : undefined)
      if (!isFresh) feedReadAt = Date.now()
      return result
    } finally {
      running = undefined
    }
  }

  return {
    read: () => readAbout(strapi, checks),
    async refresh(options) {
      running ??= runOnce(options?.force === true)
      checks = await running
      return readAbout(strapi, checks)
    },
  }
}
