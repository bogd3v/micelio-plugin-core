import { z } from 'zod'
import { EXTENSION_ID, LOCALISED_LOCALES } from '../constants/extensions'
import type {
  AdminPageRegistration,
  ExportSectionRegistration,
  LocalisedText,
  SiteSectionRegistration,
  StatusChecksRegistration,
} from '../types/extensions'

const FORMAT_VERSION = /^\d+\.\d+$/
const PAGE_PATH = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\/[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)*$/
const COMPONENT_UID = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/

const id = z.string().regex(EXTENSION_ID, 'must be lower case letters, digits and hyphens')
const permission = z.string().min(1, 'must name an admin permission')
const handler = z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function', {
  message: 'must be a function',
})

// `es` is optional here on purpose: the core falls back to `en` (see `missingLocales`).
const text = z.looseObject({ en: z.string().min(1), es: z.string().optional() })

const adminPage = z.object({
  id,
  group: z.enum(['site', 'content', 'overview']),
  label: text,
  to: z.string().regex(PAGE_PATH, 'must be lower case letters, digits, hyphens and "/"'),
  permission,
})
const siteSection = z.object({
  id,
  component: z.string().regex(COMPONENT_UID, 'must be "<category>.<name>"'),
  label: text,
  panel: z.string().min(1),
  permission,
})
const statusChecks = z.object({ id, label: text, permission, run: handler })
const exportSection = z.object({
  id,
  version: z.string().regex(FORMAT_VERSION, 'must be "major.minor"'),
  personalData: z.boolean(),
  permission,
  write: handler,
  read: handler,
})

/** What a registration is checked with: the first problem becomes the `TypeError`. */
function parse<T>(kind: string, schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const where = issue?.path.join('.') || 'registration'
  throw new TypeError(`micelio: ${kind}: ${where} ${issue?.message ?? 'is invalid'}`)
}

/** Checks an admin page registration. */
export function parseAdminPage(value: unknown): AdminPageRegistration {
  return parse('registerAdminPage', adminPage, value) as AdminPageRegistration
}

/** Checks a site section registration. */
export function parseSiteSection(value: unknown): SiteSectionRegistration {
  return parse('registerSiteSection', siteSection, value) as SiteSectionRegistration
}

/** Checks a status checks registration. */
export function parseStatusChecks(value: unknown): StatusChecksRegistration {
  return parse('registerStatusChecks', statusChecks, value) as StatusChecksRegistration
}

/** Checks an export section registration. */
export function parseExportSection(value: unknown): ExportSectionRegistration {
  return parse('registerExportSection', exportSection, value) as ExportSectionRegistration
}

/**
 * The locales a text lacks, for a plugin's own `check`: the core falls back to `en`, so a missing
 * `es` is not an error at runtime, only here. An empty or blank text counts as missing.
 *
 * @example
 * ```ts
 * expect(missingLocales({ en: 'Fediverse', es: '' })).toEqual(['es'])
 * ```
 */
export function missingLocales(value: Partial<LocalisedText>): string[] {
  return LOCALISED_LOCALES.filter((locale) => !value[locale]?.trim())
}
