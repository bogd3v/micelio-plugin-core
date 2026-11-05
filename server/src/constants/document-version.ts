/**
 * The request header with which a client names the version of a draft it is saving over: the
 * draft's `updatedAt` as the Content Manager answered it.
 */
export const EXPECTED_VERSION_HEADER = 'x-micelio-expected-version'

/** The code of the refusal of a save over a draft that changed since the client read it. */
export const VERSION_CONFLICT = 'versionConflict'
