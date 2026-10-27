/** The page type of a document that has no `pageType` of its own, or one the budgets do not list. */
export const DEFAULT_PAGE_TYPE = 'standard'

/** The budgets the core ships, in kB as sent, by page type (decision 7 of the builder: configuration only). */
export const DEFAULT_PAGE_TYPE_BUDGETS_KB: Readonly<Record<string, number>> = {
  landing: 60,
  standard: 120,
  'long-read': 160,
}

/**
 * The content types measured at publish when the host lists none (`budgets.contentTypes`): the ones
 * the frontend previews, and so the only ones its weight route answers for.
 */
export const DEFAULT_MEASURED_TYPES: readonly string[] = ['api::page.page', 'api::article.article']

/** The path, on the site's `url`, of the frontend's weight report for a document (`<uid>` and `<documentId>` follow it). */
export const WEIGHT_PATH = '/api/preview'

/** How many times the plugin asks again after the weight route answers `429`, each with a new system grant. */
export const WEIGHT_MAX_RETRIES = 3

/** The longest the plugin waits for one `Retry-After`, in seconds; a longer one is capped. */
export const WEIGHT_RETRY_CAP_SECONDS = 5

/** The wait before asking again when a `429` carries no usable `Retry-After`, in seconds. */
export const WEIGHT_RETRY_DEFAULT_SECONDS = 1

/** How long one request to the weight route may take, in milliseconds; the system grant lives 60 s. */
export const WEIGHT_TIMEOUT_MS = 30_000
