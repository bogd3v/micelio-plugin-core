import type { Core, Modules, UID } from '@strapi/strapi'
import { SceneBackgroundLimitError } from '../islands/error'
import { findBackgroundSceneExcess } from '../islands/rules'
import { ProseHeadingError } from '../prose-headings/error'
import { findProseHeadingViolation } from '../prose-headings/rules'
import { SectionAnchorError } from '../section-anchor/error'
import { findAnchorViolation } from '../section-anchor/rules'
import { BlockOptionError } from './error'
import { findBlockOptionViolation } from './rules'

/** The actions that write `data`; `clone` takes it too (the Content Manager's duplicate). */
const CHECKED_ACTIONS: ReadonlySet<string> = new Set(['create', 'update', 'clone'])

type Params = Record<string, unknown> & { data?: Record<string, unknown> }

/**
 * The document service middleware that refuses a save whose blocks carry an option the catalogue
 * does not allow (ADR-0018, section 1).
 *
 * @remarks
 * On `create`, `update` and `clone` (the Content Manager's duplicate) of any type, it checks every dynamic zone in the data. The zones the
 * data does not name are left alone, so a save that does not touch the blocks cannot fail on them.
 * Stored content is not re-checked: only what is being written.
 *
 * It also refuses a zone with more than one `scene` block of `variant: background`, and a section
 * `anchor` that is not a kebab-case slug or that two blocks of the page share (`sectionAnchorInvalid`), and a `prose` block whose Markdown body opens below `h2`, has an `h1` or
 * skips a level (`proseHeadingInvalid`).
 *
 * @throws {@link BlockOptionError} with the block, the option and the values it allows, or
 * `SceneBackgroundLimitError` {@link SectionAnchorError} or {@link ProseHeadingError}.
 */
export function blockOptionsDocuments(
  strapi: Core.Strapi
): Modules.Documents.Middleware.Middleware {
  return async (context, next) => {
    if (!CHECKED_ACTIONS.has(context.action)) return next()
    const data = (context.params as Params).data
    if (data) {
      const attributes = strapi.contentType(context.uid as UID.ContentType).attributes
      const zones: Record<string, unknown[]> = {}
      for (const [name, attribute] of Object.entries(attributes)) {
        const zone = data[name]
        if (attribute.type !== 'dynamiczone' || !Array.isArray(zone)) continue
        const violation = findBlockOptionViolation(zone)
        if (violation) throw new BlockOptionError(violation)
        const excess = findBackgroundSceneExcess(zone)
        if (excess) throw new SceneBackgroundLimitError(excess)
        zones[name] = zone
      }
      const anchor = findAnchorViolation(zones)
      if (anchor) throw new SectionAnchorError(anchor)
      const heading = findProseHeadingViolation(zones)
      if (heading) throw new ProseHeadingError(heading)
    }
    return next()
  }
}
