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
