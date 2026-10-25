import type { Core, UID } from '@strapi/strapi'
import { SITE_SECTION_ATTRIBUTE_PREFIX } from '../constants/extensions'
import { SITE_UID } from '../constants/site'
import type { PluginChecksResult } from '../types/status'
import type {
  AdminPageRegistration,
  ExportSectionRegistration,
  ExtensionSite,
  MicelioExtensions,
  SiteSectionRegistration,
  StatusChecksRegistration,
} from '../types/extensions'
import { runPluginChecks } from './checks'
import { parseAdminPage, parseExportSection, parseSiteSection, parseStatusChecks } from './validate'

/** The extension points with what only the core calls: reading the registrations. */
export interface ExtensionRegistry extends MicelioExtensions {
  /** The registered pages, in registration order. */
  adminPages(): AdminPageRegistration[]
  /** The registered site sections, in registration order. */
  siteSections(): SiteSectionRegistration[]
  /** The registered status checks, in registration order. */
  statusChecks(): StatusChecksRegistration[]
  /** The registered export sections, in registration order. */
  exportSections(): ExportSectionRegistration[]
  /** The attribute of `plugin::micelio.site` that holds a site section. */
  siteSectionAttribute(id: string): string
  /**
   * Runs every registered check for each site and keeps the results as the latest.
   *
   * @remarks
   * Plugins run one after the other, so a slow plugin delays the rest but never runs two of its
   * own checks at once.
   */
  runStatusChecks(sites: ExtensionSite[]): Promise<void>
  /** The latest results by plugin `id`; a plugin that has not run has `ranAt: null`. */
  statusResults(): Record<string, PluginChecksResult>
}

const attributeOf = (id: string): string =>
  `${SITE_SECTION_ATTRIBUTE_PREFIX}${id.replace(/-/g, '_')}`

/** A new, empty registry; the `extensions` service holds the one of a Strapi instance. */
export function createExtensionRegistry(strapi: Core.Strapi): ExtensionRegistry {
  const pages: AdminPageRegistration[] = []
  const sections: SiteSectionRegistration[] = []
  const checks: StatusChecksRegistration[] = []
  const exports: ExportSectionRegistration[] = []
  const results = new Map<string, { ranAt: string; checks: PluginChecksResult['checks'] }>()

  const taken = (kind: string, list: { id: string }[], id: string): void => {
    if (list.some((entry) => entry.id === id)) {
      throw new TypeError(`micelio: ${kind}: "${id}" is already registered`)
    }
  }

  return {
    registerAdminPage(value) {
      const page = parseAdminPage(value)
      taken('registerAdminPage', pages, page.id)
      if (pages.some(({ to }) => to === page.to)) {
        throw new TypeError(`micelio: registerAdminPage: to "${page.to}" is already taken`)
      }
      pages.push(page)
    },
    registerSiteSection(value) {
      const section = parseSiteSection(value)
      taken('registerSiteSection', sections, section.id)
      if (!(section.component in strapi.components)) {
        throw new TypeError(
          `micelio: registerSiteSection: component "${section.component}" is not registered`
        )
      }
      if (hasDatabaseModels(strapi)) {
        throw new TypeError(
          'micelio: registerSiteSection: call it in `register`, before the models are built'
        )
      }
      const attribute = attributeOf(section.id)
      strapi.get('content-types').extend(SITE_UID, (contentType: { attributes: object }) => {
        Object.assign(contentType.attributes, {
          [attribute]: {
            type: 'component',
            repeatable: false,
            component: section.component,
            // Out of the content API: the section travels only through `GET /micelio/sites`,
            // with the plugin's permission.
            private: true,
            pluginOptions: { i18n: { localized: false }, micelio: { export: 'always' } },
          },
        })
      })
      sections.push(section)
    },
    registerStatusChecks(value) {
      const registration = parseStatusChecks(value)
      taken('registerStatusChecks', checks, registration.id)
      checks.push(registration)
    },
    registerExportSection(value) {
      const section = parseExportSection(value)
      taken('registerExportSection', exports, section.id)
      exports.push(section)
    },
    adminPages: () => [...pages],
    siteSections: () => [...sections],
    statusChecks: () => [...checks],
    exportSections: () => [...exports],
    siteSectionAttribute: attributeOf,
    async runStatusChecks(sites) {
      for (const registration of checks) {
        const found = []
        for (const site of sites)
          found.push(...(await runPluginChecks(strapi.log, registration, site)))
        results.set(registration.id, { ranAt: new Date().toISOString(), checks: found })
      }
    },
    statusResults() {
      return Object.fromEntries(
        checks.map((registration) => [
          registration.id,
          {
            label: registration.label,
            ranAt: results.get(registration.id)?.ranAt ?? null,
            checks: results.get(registration.id)?.checks ?? [],
          },
        ])
      )
    },
  }
}

/** Whether Strapi has built the database models, after which a content type cannot change. */
function hasDatabaseModels(strapi: Core.Strapi): boolean {
  return strapi.db.metadata.has(SITE_UID as UID.ContentType)
}
