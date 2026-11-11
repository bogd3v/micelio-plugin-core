import type { ComponentType } from 'react'

/** Loads the component of a page; the module's default export. */
export type PageLoader = () => Promise<{ default: ComponentType }>

const loaders = new Map<string, PageLoader>()

/**
 * Provides the component of the page a sibling plugin registered on the server with
 * `registerAdminPage`, by its `id`.
 *
 * @remarks
 * A sibling plugin calls this through the Micelio admin plugin's `apis`, in its own `bootstrap`
 * (`app.getPlugin('micelio').apis.registerPage(id, () => import('./pages/Fediverse'))`): the
 * Micelio plugin is registered by then, whatever the order the admin registers plugins in.
 */
export function registerPage(id: string, loader: PageLoader): void {
  loaders.set(id, loader)
}

/** The loader registered for a page `id`, if its plugin provided one. */
export function pageLoaderOf(id: string): PageLoader | undefined {
  return loaders.get(id)
}

/** What the Sites page gives the panel of a site section. */
export interface SitePanelProps {
  /** The selected site. */
  site: { documentId: string; slug: string }
  /** The section's current data for that site (its component's instance), `null` if it has none yet. */
  section: unknown
  /** Whether the caller may update the `Site` type: a panel that edits offers it only then. */
  canWrite: boolean
}

/** Loads the component of a site panel; the module's default export. */
export type SitePanelLoader = () => Promise<{ default: ComponentType<SitePanelProps> }>

const panelLoaders = new Map<string, SitePanelLoader>()

/**
 * Provides the component that the Sites page renders for the `panel` of a site section a sibling
 * plugin registered on the server with `registerSiteSection`.
 *
 * @remarks
 * A sibling plugin calls this through the Micelio admin plugin's `apis`, in its own `bootstrap`
 * (`app.getPlugin('micelio').apis.registerSitePanel('fediverse.actor', () => import('./Actor'))`).
 * The loader runs only when the page renders the panel, and the page renders it only for a caller
 * who has the section's `permission`: no code of the panel is fetched for anyone else. The
 * component receives `{ site, section, canWrite }` (`SitePanelProps`). A `panel` with no registered
 * component shows a notice that links to the site's Content Manager entry.
 */
export function registerSitePanel(name: string, loader: SitePanelLoader): void {
  panelLoaders.set(name, loader)
}

/** The loader registered for a `panel` name, if its plugin provided one. */
export function sitePanelLoaderOf(name: string): SitePanelLoader | undefined {
  return panelLoaders.get(name)
}
