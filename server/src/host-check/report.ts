import type { HostCheckReport, HostCheckResult } from '../types/host-check'

/** Builds the report of a run from its results. */
export function buildHostCheckReport(
  results: HostCheckResult[],
  environment: string,
  checkedAt: Date
): HostCheckReport {
  const ok = results.every(({ required, status }) => !required || status !== 'fail')
  return { ok, environment, checkedAt: checkedAt.toISOString(), results }
}

/** One line per check, as `micelio doctor` prints them: status, id, what it found and the fix. */
export function formatHostCheckReport(report: HostCheckReport): string {
  const lines = report.results.map(describeResult)
  const verdict = report.ok ? 'every required check passes' : 'a required check fails'
  return [...lines, '', `Host check (${report.environment}): ${verdict}.`].join('\n')
}

/** The message a failed result is logged or refused with: the check's id, what it found and the fix. */
export function describeResult(result: HostCheckResult): string {
  const label = `${result.status.padEnd(4)}  ${result.id}${result.required ? '' : ' (optional)'}`
  const fix = result.fix ? ` Fix: ${result.fix}` : ''
  return `${label}: ${result.detail}${fix}`
}
