import type { BuilderBlock } from './model'

/** The header that names the version of the draft a save was made over; `server/src/constants/document-version.ts`. */
export const EXPECTED_VERSION_HEADER = 'X-Micelio-Expected-Version'

/** The code of the refusal of a save over a draft someone else saved since. */
export const VERSION_CONFLICT = 'versionConflict'

/** Why the server refused a save of the page, narrowed from its error. */
export interface SaveRefusal {
  /** The stable code: `blockOptionInvalid`, `blockNotAllowed` or Strapi's own error name. */
  code: string
  /** The sentence the server wrote. */
  detail: string
  /** The catalogue id of the block the refusal is about, when it names one. */
  block?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

/**
 * Reads the refusal of a failed save: the problem detail the `site-scope` middleware answers, or
 * Strapi's `ValidationError` with the same members in `error.details` (the Content Manager's route).
 *
 * @remarks
 * The branch is on `code`, never on the text. Returns `undefined` for an error that carries neither.
 */
export function refusalOf(error: unknown): SaveRefusal | undefined {
  const data = isRecord(error) && isRecord(error.response) ? error.response.data : undefined
  if (!isRecord(data)) return undefined
  const strapi = isRecord(data.error) ? data.error : undefined
  const members = isRecord(strapi?.details) ? strapi.details : data
  const code = text(members.code) ?? text(strapi?.name)
  if (!code) return undefined
  return {
    code,
    detail: text(data.detail) ?? text(strapi?.message) ?? code,
    block: text(members.block),
  }
}

/**
 * The block of the page a refusal names, by its catalogue id: the one just added (not stored yet)
 * before an older one of its kind; `undefined` when it names none or the page holds none.
 */
export function refusedBlockOf(
  blocks: BuilderBlock[],
  id: string | undefined,
  entryOf: (block: BuilderBlock) => { id: string } | undefined
): BuilderBlock | undefined {
  if (!id) return undefined
  const named = blocks.filter((block) => entryOf(block)?.id === id)
  return named.find((block) => block.id === undefined) ?? named[0]
}
