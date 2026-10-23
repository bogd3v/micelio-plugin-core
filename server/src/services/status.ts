import type { Core } from '@strapi/strapi'
import { readStatus } from '../status/read'
import type { StatusReport } from '../types/status'

/** The `status` service: `strapi.plugin('micelio').service('status')`, behind the status page. */
export interface StatusService {
  /** What the status page shows; asks each site's frontend for `/_health` on every call. */
  read(): Promise<StatusReport>
}

export default ({ strapi }: { strapi: Core.Strapi }): StatusService => ({
  read: () => readStatus(strapi),
})
