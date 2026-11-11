import schema from '../../../server/src/content-types/site/schema.json'
import type { SiteWithSections } from '../../../server/src/types/status'

/** The values `defaultLocale` takes: the enumeration of the `Site` type. */
export const DEFAULT_LOCALES: string[] = schema.attributes.defaultLocale.enum

/** The five fields the Sites page edits, as the form holds them. */
export interface SiteFormValues {
  name: string
  slug: string
  /** Comma-separated, as the editor types it. */
  hosts: string
  defaultLocale: string
  isDefault: boolean
}

/** The text of a field of the Content Manager's answer, or `fallback`. */
const textOf = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

/**
 * The form's values from `data` of `GET /content-manager/collection-types/plugin::micelio.site/:documentId`.
 *
 * @remarks `hosts` is a JSON field: anything that is not a list of strings reads as none.
 */
export function formValuesOf(data: Record<string, unknown>): SiteFormValues {
  const hosts = Array.isArray(data.hosts)
    ? data.hosts.filter((host): host is string => typeof host === 'string')
    : []
  return {
    name: textOf(data.name),
    slug: textOf(data.slug),
    hosts: hosts.join(', '),
    defaultLocale: textOf(data.defaultLocale, DEFAULT_LOCALES[0]),
    isDefault: data.isDefault === true,
  }
}

/** The list of host names in a comma-separated text: trimmed, with the empty ones left out. */
export function parseHosts(text: string): string[] {
  return text
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host !== '')
}

/**
 * The body of the save: only the five fields the page edits, so the site's other fields keep
 * their values.
 */
export function saveBodyOf(values: SiteFormValues): Record<string, unknown> {
  return {
    name: values.name.trim(),
    slug: values.slug.trim(),
    hosts: parseHosts(values.hosts),
    defaultLocale: values.defaultLocale,
    isDefault: values.isDefault,
  }
}

/** Whether the site matches what the editor typed: its name, slug or a host contains it, in any case. */
export function matchesSearch(site: SiteWithSections, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return [site.name, site.slug, ...site.hosts].some((text) => text.toLowerCase().includes(needle))
}

/**
 * The message of a refused save, in the admin's language: the translation of the refusals of
 * `server/src/sites/rules.ts` that have one, and the server's own text otherwise.
 *
 * @param refusal - What the server wrote.
 * @param t - The translator of the plugin's strings (`useMessages`).
 */
export function refusalText(
  refusal: string,
  t: (id: string, values?: Record<string, string | number>) => string
): string {
  const taken = /^Another site already has the host "(.*)"$/.exec(refusal)
  if (taken) return t('sites.refusal.hostTaken', { host: taken[1] ?? '' })
  if (refusal === 'Make another site the default instead') return t('sites.refusal.defaultUnset')
  return refusal
}

/** What the server wrote in a refusal the admin's client threw; empty when it carries none. */
export function refusalOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const { message, response } = error as {
    message?: unknown
    response?: { data?: { error?: { message?: unknown } } }
  }
  const sent = response?.data?.error?.message
  if (typeof sent === 'string' && sent !== '') return sent
  return typeof message === 'string' ? message : ''
}
