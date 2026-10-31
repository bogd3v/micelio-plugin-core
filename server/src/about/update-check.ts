import packageJson from '../../../package.json'
import type { AboutUpdate } from '../types/about'

/** Where the release feed is read from unless `MICELIO_UPDATE_FEED` says otherwise: the latest release of the core. */
export const DEFAULT_UPDATE_FEED = 'https://api.github.com/repos/bogd3v/micelio/releases/latest'

const FEED_TIMEOUT_MS = 5000
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)/

/** Whether the daily release check is on: it is, unless `MICELIO_UPDATE_CHECK` is `false`. */
export function isUpdateCheckOn(): boolean {
  return process.env.MICELIO_UPDATE_CHECK !== 'false'
}

/**
 * Reads the release feed and says whether a release line newer than the one this plugin supports
 * is out.
 *
 * @remarks
 * The only request the plugin makes to a host that is not a site's frontend, and only when
 * {@link isUpdateCheckOn}. It sends no identifier, no version and no cookie. A feed that is
 * unreachable, slow or not in the expected shape answers `unknown`, never an error.
 */
export async function checkForUpdate(): Promise<AboutUpdate> {
  if (!isUpdateCheckOn()) return { state: 'off' }
  try {
    const response = await fetch(process.env.MICELIO_UPDATE_FEED || DEFAULT_UPDATE_FEED, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    })
    if (!response.ok) return { state: 'unknown' }
    const release = (await response.json()) as { tag_name?: unknown; html_url?: unknown } | null
    const latest = typeof release?.tag_name === 'string' ? VERSION.exec(release.tag_name) : null
    const line = VERSION.exec(`${packageJson.micelio}.0`)
    if (!latest || !line) return { state: 'unknown' }
    const isNewer =
      Number(latest[1]) > Number(line[1]) ||
      (Number(latest[1]) === Number(line[1]) && Number(latest[2]) > Number(line[2]))
    if (!isNewer) return { state: 'current' }
    const url = typeof release?.html_url === 'string' ? release.html_url : ''
    return { state: 'available', version: `${latest[1]}.${latest[2]}.${latest[3]}`, url }
  } catch {
    // Unreachable, slow or not JSON: the page says it could not tell, and tries again tomorrow.
    return { state: 'unknown' }
  }
}
