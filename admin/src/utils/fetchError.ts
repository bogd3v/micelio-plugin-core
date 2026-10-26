/** The HTTP status of an error the admin's fetch client threw, if it carries one. */
export function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const { status, response } = error as { status?: unknown; response?: { status?: unknown } }
  if (typeof status === 'number') return status
  return typeof response?.status === 'number' ? response.status : undefined
}
