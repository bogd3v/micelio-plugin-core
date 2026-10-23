/** What one check of the host check found (ADR-0017, section 7). */
export type HostCheckStatus = 'pass' | 'fail' | 'skip'

/** The result of one check, as the boot log, `micelio doctor` and the status page show it. */
export interface HostCheckResult {
  /** Stable and machine-readable: the status page translates by it, never by the text. */
  id: string
  /** What the check verifies, in English. */
  title: string
  /** Whether a failure stops the boot in production; any other failure is a warning. */
  required: boolean
  /** `skip` when the check does not apply, such as PostgreSQL outside production. */
  status: HostCheckStatus
  /** What the check found. It never holds a secret: no credential, token or full URL. */
  detail: string
  /** What the operator does to make it pass; present when `status` is `fail`. */
  fix?: string
}

/** The result of a run of the host check. */
export interface HostCheckReport {
  /** False when a required check failed. */
  ok: boolean
  /** Strapi's environment (`NODE_ENV`) the run saw. */
  environment: string
  /** When the run finished, as an ISO 8601 date. */
  checkedAt: string
  results: HostCheckResult[]
}
