// A host name as RFC 1123 allows it, in lower case: labels of letters, digits and hyphens, at most
// 63 characters each, no hyphen at either end.
const HOST_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/

/**
 * The `hosts` of a site in lower case and without repeats, or the reason they are invalid.
 *
 * @param value - The field as it arrives: `null` and `undefined` mean no host names.
 * @returns The host names, or a message that names the first invalid one.
 */
export function normalizeHosts(value: unknown): string[] | { error: string } {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) return { error: 'hosts must be a list of host names' }
  const hosts: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return { error: 'hosts must be a list of host names' }
    const host = item.trim().toLowerCase()
    if (!HOST_PATTERN.test(host)) {
      return { error: `"${item}" is not a host name (no scheme, port or path)` }
    }
    if (!hosts.includes(host)) hosts.push(host)
  }
  return hosts
}
