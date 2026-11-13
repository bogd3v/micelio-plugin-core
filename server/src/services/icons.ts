import type { Core } from '@strapi/strapi'
import { ICONS, type IconCatalogue } from '../../../contract/icons'

/** The `icons` service: `strapi.plugin('micelio').service('icons')`. */
export interface IconsService {
  /**
   * The catalogue a save is checked against: the pinned names and aliases of `contract/icons.ts`.
   * Frozen: no plugin can widen what a save accepts.
   */
  readonly catalogue: Readonly<IconCatalogue>
  /**
   * Test hook: adds (`name` given) or removes (`name` `undefined`) an alias, which the pin lacks
   * at its first version (`ICON_ALIASES` is empty). Throws outside `NODE_ENV=test`.
   */
  setAliasForTests(alias: string, name: string | undefined): void
}

const freeze = (aliases: Record<string, string>): Readonly<IconCatalogue> =>
  Object.freeze({
    ...ICONS,
    names: Object.freeze([...ICONS.names]) as string[],
    aliases: Object.freeze(aliases),
  })

export default (_context: { strapi: Core.Strapi }): IconsService => {
  let current = freeze({ ...ICONS.aliases })
  return {
    get catalogue() {
      return current
    },
    setAliasForTests(alias, name) {
      if (process.env.NODE_ENV !== 'test') throw new Error('setAliasForTests is for the suites')
      const aliases = { ...current.aliases }
      if (name === undefined) delete aliases[alias]
      else aliases[alias] = name
      current = freeze(aliases)
    },
  }
}
