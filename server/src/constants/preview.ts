/** The admin permission that asks for a preview token; the admin route checks it. */
export const PREVIEW_PERMISSION = 'plugin::micelio.preview'

/** The UID of the store of preview tokens and grants. */
export const PREVIEW_CREDENTIAL_UID = 'plugin::micelio.preview-credential'

/** The path on the site's `url` that receives the preview token (ADR-0019, section 3). */
export const PREVIEW_PATH = '/_preview'

/** The request header that carries a preview grant to the draft route. */
export const PREVIEW_GRANT_HEADER = 'x-micelio-preview-grant'

/** How long a preview token is valid, in seconds. */
export const PREVIEW_TOKEN_TTL_SECONDS = 60

/** How long a preview grant is valid, in seconds. */
export const PREVIEW_GRANT_TTL_SECONDS = 15 * 60

/** How long a system grant is valid, in seconds (ADR-0019, amendment of 2026-10-25). */
export const PREVIEW_SYSTEM_GRANT_TTL_SECONDS = 60

/** How long an expired credential stays in the store before the next token request removes it. */
export const PREVIEW_CREDENTIAL_RETENTION_SECONDS = 60 * 60

/** The window of the rate limits, in seconds. */
export const PREVIEW_RATE_WINDOW_SECONDS = 60

/** Token requests an admin user may make in a window. */
export const PREVIEW_TOKEN_RATE_LIMIT = 20

/** Exchanges an API token may make in a window. */
export const PREVIEW_EXCHANGE_RATE_LIMIT = 60
