import { errors } from '@strapi/utils'
import { REUSABLE_BLOCK_CODES } from '../constants/reusable-blocks'
import type { ReusableBlockViolation } from './rules'

/** A page that references a reusable block, in any locale, draft or published. */
export interface ReferencingPage {
  /** The UID of the page's content type. */
  uid: string
  documentId: string
  /** The page's locale; `null` for a type without i18n. */
  locale: string | null
  /** Its `title`, else its `slug`, else its `documentId`. */
  title: string
  /** Whether the page has a published version in this locale. */
  published: boolean
}

const REASONS: Record<ReusableBlockViolation['reason'], (v: ReusableBlockViolation) => string> = {
  count: (v) => `A reusable block holds exactly one block, not ${v.count}`,
  reference: (v) => `The block of a reusable block cannot be a reference (${v.component})`,
  group: (v) =>
    `The block of a reusable block carries no group key (${v.component}): the reference does`,
}

/**
 * A save or a delete refused by a rule of the reusable blocks (ADR-0022, section 1).
 *
 * @remarks
 * Strapi answers it as a `ValidationError` (400); `details.code` is one of
 * `REUSABLE_BLOCK_CODES`, and `details.pages` lists the referencing pages of a refused delete.
 */
export class ReusableBlockError extends errors.ValidationError {
  /** The block of a reusable block breaks a rule: `reusableBlockInvalid`. */
  static invalid(violation: ReusableBlockViolation): ReusableBlockError {
    return new ReusableBlockError(REASONS[violation.reason](violation), {
      code: REUSABLE_BLOCK_CODES.invalid,
      ...violation,
    })
  }

  /** A page references a reusable block of another site: `reusableBlockOtherSite`. */
  static otherSite(documentId: string): ReusableBlockError {
    return new ReusableBlockError(
      `The reusable block ${documentId} belongs to another site: a page references only its own site's`,
      { code: REUSABLE_BLOCK_CODES.otherSite, documentId }
    )
  }

  /** A delete of a reusable block that pages reference: `reusableBlockInUse`, with the pages. */
  static inUse(pages: ReferencingPage[]): ReusableBlockError {
    const titles = pages.map((page) => `${page.title} (${page.locale ?? 'no locale'})`)
    return new ReusableBlockError(
      `The reusable block is used on ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}: ` +
        `${titles.join(', ')}. Detach or replace it there first`,
      { code: REUSABLE_BLOCK_CODES.inUse, pages }
    )
  }

  private constructor(message: string, details: Record<string, unknown>) {
    super(message, details)
  }
}
