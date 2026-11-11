/** The HTTP status of an error the admin's fetch client threw, if it carries one. */
export function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const { status, response } = error as { status?: unknown; response?: { status?: unknown } }
  if (typeof status === 'number') return status
  return typeof response?.status === 'number' ? response.status : undefined
}

/**
 * The option that makes the admin's client answer a refusal instead of throwing it: see
 * {@link outcomeOf}.
 *
 * @remarks
 * A 401 is still thrown: the client refreshes an expired access token on it and sends the request
 * again, and a request that answers it never refreshes.
 */
export const ANSWER_REFUSALS = { validateStatus: (status: number) => status !== 401 } as const

/** What a request to a route that answers problem details came to. */
export type Outcome<T> = { ok: true; data: T } | { ok: false; code?: string; detail?: string }

/**
 * Reads the answer of a request sent with {@link ANSWER_REFUSALS}: the data, or the `code` and
 * `detail` of the problem detail (RFC 9457) the route refused with.
 *
 * @remarks
 * The admin's client throws a refusal that is not Strapi's own error envelope as a bare "Unknown
 * Server Error" and drops its body, so the plugin's routes are asked to answer instead. A body that
 * is neither data nor a problem detail is a refusal with no members.
 */
export function outcomeOf<T>(answer: { data: unknown }): Outcome<T> {
  const body = answer.data
  if (typeof body === 'object' && body !== null) {
    const { status, code, detail, data, error } = body as Record<string, unknown>
    if (typeof status === 'number' && status >= 400) {
      return {
        ok: false,
        code: typeof code === 'string' ? code : undefined,
        detail: typeof detail === 'string' ? detail : undefined,
      }
    }
    if (error === undefined && data !== undefined) return { ok: true, data: data as T }
  }
  return { ok: false }
}
