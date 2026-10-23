import type { HostCheckResult } from '../../../server/src/types/host-check'

/** Text to show: a message id to translate, or the server's own text when there is no message. */
export type Text = { messageId: string } | { text: string }

/**
 * The title or the fix of a host check result, translated by its `id`.
 *
 * @remarks
 * A check the admin has no message for (a newer server) falls back to the server's English text.
 *
 * @param isKnown - Whether a message id exists in the plugin's translations.
 * @returns `null` for the fix of a result that has none.
 */
export function checkText(
  result: HostCheckResult,
  part: 'title' | 'fix',
  isKnown: (messageId: string) => boolean
): Text | null {
  const fallback = part === 'title' ? result.title : result.fix
  if (fallback === undefined) return null
  const messageId = `status.hostCheck.check.${result.id}.${part}`
  return isKnown(messageId) ? { messageId } : { text: fallback }
}
