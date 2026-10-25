import type { PluginChecksResult, StatusReport } from '../../../server/src/types/status'

/**
 * The diagnostics a person pastes into a support request: one line for the plugin, one for the
 * host check and one per sibling plugin that registered checks.
 *
 * @remarks
 * Always English and free of site content: a plugin's line counts its results, it does not copy
 * what they found.
 */
export function diagnosticsText(report: StatusReport): string {
  const lines = [`Micelio ${report.plugin.version} (core release line ${report.plugin.coreLine})`]
  if (report.hostCheck) {
    const failed = report.hostCheck.results.filter(({ status }) => status === 'fail').length
    lines.push(`Host check: ${report.hostCheck.ok ? 'ok' : 'fails'} (${failed} failed)`)
  } else {
    lines.push('Host check: not run')
  }
  for (const [id, result] of Object.entries(report.plugins)) lines.push(pluginLine(id, result))
  return lines.join('\n')
}

function pluginLine(id: string, result: PluginChecksResult): string {
  if (result.ranAt === null) return `${id}: checks not run`
  const count = (status: string) => result.checks.filter((check) => check.status === status).length
  return `${id}: ${count('ok')} ok, ${count('warn')} warn, ${count('fail')} fail`
}
