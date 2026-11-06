/** The UID of the page templates: a saved sequence of blocks with their options, one row per template. */
export const PAGE_TEMPLATE_UID = 'plugin::micelio.page-template'

/** The admin permission that saves, exports and imports a site's templates; the admin keeps its own copy. */
export const TEMPLATES_MANAGE_PERMISSION = 'plugin::micelio.templates.manage'

/** The admin permission of the Content Manager that creates an entry of a type: the subject is its UID. */
export const CREATE_PERMISSION = 'plugin::content-manager.explorer.create'

/** The `format` member of an exported template; a change of the shape raises it. */
export const TEMPLATE_FORMAT = 1

/** The `code` of the transition refused because a page still holds the sample text of its template. */
export const SAMPLE_TEXT_PRESENT = 'sampleTextPresent'

/** The `code`s of a refused template. */
export const TEMPLATE_CODES = {
  invalid: 'templateInvalid',
  nameTaken: 'templateNameTaken',
  blockNotAllowed: 'templateBlockNotAllowed',
  overBudget: 'templateOverBudget',
  notFound: 'templateNotFound',
  forbidden: 'templatesForbidden',
} as const

/** The longest name of a template, in characters. */
export const TEMPLATE_NAME_MAX_LENGTH = 80

/** The longest description of a template, in characters. */
export const TEMPLATE_DESCRIPTION_MAX_LENGTH = 300
