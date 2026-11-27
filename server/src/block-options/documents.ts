import type { Core, Modules, UID } from '@strapi/strapi'
import { BlockGroupError } from '../block-groups/error'
import { findGroupViolation } from '../block-groups/rules'
import { SceneBackgroundLimitError } from '../islands/error'
import { findBackgroundSceneExcess } from '../islands/rules'
import { ProseHeadingError } from '../prose-headings/error'
import { findProseHeadingViolation } from '../prose-headings/rules'
import { SectionAnchorError } from '../section-anchor/error'
import { findAnchorViolation } from '../section-anchor/rules'
import { CodeHighlightError } from '../code-highlight/error'
import { findHighlightViolation } from '../code-highlight/rules'
import { TableCellsError } from '../table-cells/error'
import { findCellsViolation } from '../table-cells/rules'
import { TestimonialRatingError } from '../testimonial-rating/error'
import { findRatingViolation } from '../testimonial-rating/rules'
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
 * skips a level (`proseHeadingInvalid`), and a `testimonials` item whose `rating` is not a whole number from 1 to 5
 * (`testimonialRatingInvalid`), and a `code` block that highlights a line outside its code
 * (`codeHighlightInvalid`), and a `table` row whose number of cells is not the number of its
 * columns (`tableCellsInvalid`), and a group of blocks (ADR-0022, section 2) split into two runs or
 * whose members set two tones (`blockGroupInvalid`).
 *
 * @throws {@link BlockOptionError} with the block, the option and the values it allows, or
 * `SceneBackgroundLimitError` {@link SectionAnchorError} {@link ProseHeadingError} {@link TestimonialRatingError} {@link CodeHighlightError} {@link TableCellsError} or {@link BlockGroupError}.
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
      const rating = findRatingViolation(zones)
      if (rating) throw new TestimonialRatingError(rating)
      const highlight = findHighlightViolation(zones)
      if (highlight) throw new CodeHighlightError(highlight)
      const cells = findCellsViolation(zones)
      if (cells) throw new TableCellsError(cells)
      const group = findGroupViolation(zones)
      if (group) throw new BlockGroupError(group)
    }
    return next()
  }
}
