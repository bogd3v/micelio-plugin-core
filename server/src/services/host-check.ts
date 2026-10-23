import type { Core } from '@strapi/strapi'
import { evaluateHostChecks } from '../host-check/checks'
import { readHostFacts } from '../host-check/facts'
import { buildHostCheckReport, describeResult } from '../host-check/report'
import type { HostCheckReport } from '../types/host-check'

/**
 * The `hostCheck` service: `strapi.plugin('micelio').service('hostCheck')`.
 *
 * @remarks
 * Verifies what the host must provide (ADR-0017, section 7; ADR-0019, section 5).
 * `docs/operate/host-check.md` lists the checks and their fixes.
 */
export interface HostCheckService {
  /** Runs every check and keeps the report as the latest. Call it in `bootstrap` or later. */
  run(): Promise<HostCheckReport>
  /** The report of the last run, the one at boot unless something ran it since. */
  latest(): HostCheckReport | undefined
  /**
   * Runs the checks and acts on them as the boot does: logs every failure, and in production
   * refuses a failed required check.
   *
   * @throws `Error` in production when a required check fails, naming each failed check.
   */
  enforce(): Promise<HostCheckReport>
  /**
   * Makes `enforce` log a failed required check instead of refusing it, for `micelio doctor`,
   * which boots the host to report on it.
   *
   * @internal
   */
  reportOnly(): void
}

export default ({ strapi }: { strapi: Core.Strapi }): HostCheckService => {
  let latest: HostCheckReport | undefined
  let isReportOnly = false

  const run = async (): Promise<HostCheckReport> => {
    const facts = await readHostFacts(strapi)
    latest = buildHostCheckReport(evaluateHostChecks(facts), facts.environment, new Date())
    return latest
  }

  return {
    run,
    latest: () => latest,
    async enforce() {
      const report = await run()
      const failures = report.results.filter(({ status }) => status === 'fail')
      const refused = failures.filter(({ required }) => required)
      if (report.environment === 'production' && refused.length > 0 && !isReportOnly) {
        const messages = refused.map(describeResult).join('\n')
        throw new Error(`micelio: the host check failed; Strapi will not start.\n${messages}`)
      }
      for (const failure of failures) {
        strapi.log.warn(`micelio host check: ${describeResult(failure)}`)
      }
      return report
    },
    reportOnly() {
      isReportOnly = true
    },
  }
}
