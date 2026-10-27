import { useNotification } from '@strapi/strapi/admin'
import { useCallback } from 'react'
import { useHref } from 'react-router-dom'

import { useMessages } from '../messages'
import { refusalNotification, type RefusedEntry } from '../utils/refusal'

/**
 * Returns the function that tells the editor why a publish was refused, as a notification of the
 * admin with a link to the preview page of the entry (issue #106).
 *
 * @remarks
 * The control that calls `POST /micelio/transitions` (bogd3v/micelio-plugin-core#57) hands the problem
 * detail of the answer to the function it returns, which says `false` when the refusal is not a
 * budget one (`pageOverBudget`, `previewUnavailable`) and the control has its own text for it.
 */
export function useRefusalNotification(): (problem: unknown, entry: RefusedEntry) => boolean {
  const { toggleNotification } = useNotification()
  const { t } = useMessages()
  // The admin is served under a path of its own (`/admin`): the link needs it, `to` does not.
  const root = useHref('/').replace(/\/+$/, '')

  return useCallback(
    (problem, entry) => {
      const notification = refusalNotification(problem, entry, root, t)
      if (!notification) return false
      toggleNotification(notification)
      return true
    },
    [toggleNotification, t, root]
  )
}
