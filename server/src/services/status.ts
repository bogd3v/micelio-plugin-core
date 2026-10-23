import type { Core } from '@strapi/strapi'
import { readStatus } from '../status/read'
import type { HostCheckReport } from '../types/host-check'
import type { StatusReport } from '../types/status'

/** The `status` service: `strapi.plugin('micelio').service('status')`, behind the status page. */
export interface StatusService {
  /** What the status page shows; asks each site's frontend for `/_health` on every call. */
  read(): Promise<StatusReport>
  /**
   * Runs the host check again and keeps its report as the latest, for the status page.
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
      return (await strapi.plugin('micelio').service('hostCheck').run()) as HostCheckReport
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
