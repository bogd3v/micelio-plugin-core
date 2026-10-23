import { useFetchClient } from '@strapi/strapi/admin'
import { useCallback, useRef, useState } from 'react'

import type { HostCheckReport } from '../../../server/src/types/host-check'

/** The host check report the page shows, and the run that replaces it. */
export interface HostCheckRun {
  /** The latest report: the one the page loaded with, until a run answers. */
  report: HostCheckReport | null
  isRunning: boolean
  /** Whether the last run was refused or got no answer; the report is then the previous one. */
  hasFailed: boolean
  /** Runs the check again (`POST /micelio/status/host-check`). */
  run: () => Promise<HostCheckReport | null>
}

/**
 * Runs the host check again from the status page.
 *
 * @param initial - The report of `GET /micelio/status`.
 */
export function useHostCheckRun(initial: HostCheckReport | null): HostCheckRun {
  // The client is rebuilt on every render; the callback must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [report, setReport] = useState(initial)
  const [isRunning, setIsRunning] = useState(false)
  const [hasFailed, setHasFailed] = useState(false)

  const run = useCallback(async (): Promise<HostCheckReport | null> => {
    setIsRunning(true)
    setHasFailed(false)
    try {
      const response = await clientRef.current.post<{ data: HostCheckReport }>(
        '/micelio/status/host-check'
      )
      setReport(response.data.data)
      return response.data.data
    } catch {
      // A refusal or no answer: the page keeps the previous report and says the run failed.
      setHasFailed(true)
      return null
    } finally {
      setIsRunning(false)
    }
  }, [])

  return { report, isRunning, hasFailed, run }
}
