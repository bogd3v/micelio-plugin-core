import { errors } from '@strapi/utils'
import { TEMPLATE_CODES } from '../constants/page-templates'
import type { FixedViolation } from './changes'

/** The `code` of a refused template. */
export type TemplateErrorCode = (typeof TEMPLATE_CODES)[keyof typeof TEMPLATE_CODES]

/**
 * A template, or a page made from one, refused: the route answers it as a problem detail with its
 * status and `code` (`docs/api.md`), and `extensions` as members of it.
 */
export class TemplateError extends Error {
  constructor(
    readonly status: number,
    readonly code: TemplateErrorCode,
    message: string,
    /** Members the problem detail carries besides the standard ones: `site` and `block` of a refused scope, `field` of a malformed body. */
    readonly extensions: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = 'TemplateError'
  }
}

/**
 * A save refused because it removes a block the page's template fixed, or reorders the fixed blocks.
 *
 * @remarks
 * Strapi answers it as a `ValidationError` (400) where the route has no middleware to say better;
 * the `site-scope` route middleware turns it into the problem detail `docs/api.md` describes.
 */
export class FixedBlockError extends errors.ValidationError {
  constructor(readonly violation: FixedViolation) {
    super(
      violation.reason === 'removed'
        ? `The ${violation.block} block is fixed by the page's template and cannot be removed`
        : `The ${violation.block} block is fixed by the page's template and cannot be moved`,
      { code: TEMPLATE_CODES.blockFixed, block: violation.block, reason: violation.reason }
    )
  }
}
