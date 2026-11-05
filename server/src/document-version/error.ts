import { errors } from '@strapi/utils'
import { VERSION_CONFLICT } from '../constants/document-version'

/**
 * A save refused because the draft was saved by someone else after the client read it.
 *
 * @remarks
 * Strapi answers it as a `ValidationError` (400) whose `error.details.code` is `versionConflict`:
 * the Content Manager's routes have no middleware to say better, and a client branches on the code.
 */
export class VersionConflictError extends errors.ValidationError {
  constructor() {
    super('The document was saved by someone else after it was read', { code: VERSION_CONFLICT })
  }
}
