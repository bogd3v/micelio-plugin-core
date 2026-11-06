import { TEMPLATE_CODES } from '../constants/page-templates'

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
