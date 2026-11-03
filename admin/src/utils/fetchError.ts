/** The HTTP status of an error the admin's fetch client threw, if it carries one. */
export function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const { status, response } = error as { status?: unknown; response?: { status?: unknown } }
  if (typeof status === 'number') return status
  return typeof response?.status === 'number' ? response.status : undefined
}

/** The `code` and `detail` of the problem detail a failed request of the admin's client carries, if any. */
export function problemOf(error: unknown): { code?: string; detail?: string } | undefined {
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data
  if (typeof data !== 'object' || data === null) return undefined
  const { code, detail } = data as Record<string, unknown>
  return {
    code: typeof code === 'string' ? code : undefined,
    detail: typeof detail === 'string' ? detail : undefined,
  }
}
