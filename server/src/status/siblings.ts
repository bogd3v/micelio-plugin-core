import type { Core } from '@strapi/strapi'
import { EXTENSION_POINTS } from '../constants/extensions'
import { EDITORIAL_STATES } from '../constants/editorial'
import { BLOCKS } from '../../../contract/blocks'
import { HOOK_NAMES } from '../hooks'
import type { StatusContracts, StatusSibling } from '../types/status'

/** A `@micelio/*` package the host enabled next to the core. */
export interface SiblingPackage {
  /** The id Strapi knows the plugin by: its key in `config/plugins`. */
  id: string
  name: string
  version: string
}

/** The registrations of the extension points, each with the admin permission it carries. */
export interface Registrations {
  adminPages: { id: string; permission: string }[]
  siteSections: { id: string; permission: string }[]
  statusChecks: { id: string; permission: string }[]
  exportSections: { id: string; permission: string }[]
}

/**
 * The `@micelio/*` packages the host enabled next to the core.
 *
 * @remarks
 * Reads `enabledPlugins`, the list Strapi builds at boot from its dependencies and `config/plugins`
 * and keeps in `strapi.config`, with the `package.json` of each: no file is read here.
 */
export function siblingPlugins(strapi: Core.Strapi): SiblingPackage[] {
  const enabled = strapi.config.get<
    Record<string, { packageInfo?: { name?: string; version?: string } }>
  >('enabledPlugins', {})
  const found: SiblingPackage[] = []
  for (const [id, plugin] of Object.entries(enabled)) {
    const { name, version } = plugin.packageInfo ?? {}
    if (id !== 'micelio' && name?.startsWith('@micelio/') && version) {
      found.push({ id, name, version })
    }
  }
  return found.sort((a, b) => (a.name < b.name ? -1 : 1))
}

/** The Strapi plugin a registration's `permission` (`plugin::<plugin>.<action>`) belongs to. */
function ownerOf(permission: string): string | null {
  return /^plugin::([^.]+)\./.exec(permission)?.[1] ?? null
}

/**
 * Tells each sibling what it registered and the caller may see.
 *
 * @remarks
 * A registration has no owner field, but every one carries an admin permission its plugin
 * registered, so the plugin of that permission owns it. A registration whose permission names no
 * listed plugin is not shown. `can` tells whether the caller holds a permission: the ids of the
 * registrations it does not hold are left out, and `hidden` says that some were.
 */
export function describeSiblings(
  packages: SiblingPackage[],
  registrations: Registrations,
  can: (permission: string) => boolean = () => true
): StatusSibling[] {
  return packages.map(({ id, name, version }) => {
    const owned = (list: { id: string; permission: string }[]) =>
      list.filter(({ permission }) => ownerOf(permission) === id)
    const idsOf = (list: { id: string; permission: string }[]): string[] =>
      owned(list)
        .filter(({ permission }) => can(permission))
        .map((registration) => registration.id)
    return {
      name,
      version,
      adminPages: idsOf(registrations.adminPages),
      siteSections: idsOf(registrations.siteSections),
      statusChecks: idsOf(registrations.statusChecks),
      exportSections: idsOf(registrations.exportSections),
      hidden: Object.values(registrations).some((list) =>
        owned(list).some(({ permission }) => !can(permission))
      ),
    }
  })
}

/** The contracts this core exposes, read from the constants that define them. */
export function contractsOf(): StatusContracts {
  return {
    blocks: BLOCKS.length,
    editorialStates: [...EDITORIAL_STATES],
    hooks: [...HOOK_NAMES],
    extensionPoints: [...EXTENSION_POINTS],
  }
}
