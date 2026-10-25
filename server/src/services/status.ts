import type { Core } from '@strapi/strapi'
import { extensionsOf } from '../extensions'
import { readSites, readStatus } from '../status/read'
import type { HostCheckReport } from '../types/host-check'
import type { StatusReport } from '../types/status'

/** The `status` service: `strapi.plugin('micelio').service('status')`, behind the status page. */
export interface StatusService {
  /** What the status page shows; asks each site's frontend for `/_health` on every call. */
  read(): Promise<StatusReport>
  /**
   * Runs the host check and the checks of sibling plugins again and keeps their results as the
   * latest, for the status page. Answers the host check's report.
   *
   * @remarks
   * One run at a time: a call made while a run is in progress answers that run's report. It calls
   * `hostCheck.run()`, never `enforce()`, so a failed required check logs nothing and stops nothing.
   */
  runHostCheck(): Promise<HostCheckReport>
}

export default ({ strapi }: { strapi: Core.Strapi }): StatusService => {
  let running: Promise<HostCheckReport> | undefined

  const runOnce = async (): Promise<HostCheckReport> => {
    try {
      const report = (await strapi.plugin('micelio').service('hostCheck').run()) as HostCheckReport
      const sites = await readSites(strapi)
      await extensionsOf(strapi).runStatusChecks(
        sites.map(({ documentId, slug }) => ({ documentId, slug }))
      )
      return report
    } finally {
      running = undefined
    }
  }

  return {
    read: () => readStatus(strapi),
    runHostCheck() {
      running ??= runOnce()
      return running
    },
  }
}
