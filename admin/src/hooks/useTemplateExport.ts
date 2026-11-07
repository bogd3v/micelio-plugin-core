import { useFetchClient, useNotification } from '@strapi/strapi/admin'
import { useRef } from 'react'

import type { TemplateSummary } from '../../../server/src/types/page-templates'
import { useMessages } from '../messages'
import { problemOf } from '../utils/fetchError'
import { templateFileName } from '../utils/templates'

/**
 * Downloads a template as its JSON file (`micelio template import` reads it back), or tells the
 * editor why it could not.
 */
export function useTemplateExport(): (
  template: Pick<TemplateSummary, 'id' | 'name'>
) => Promise<void> {
  const { t } = useMessages()
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const { toggleNotification } = useNotification()
  return async (template) => {
    try {
      const answer = await clientRef.current.get<{ data: unknown }>(
        `/micelio/templates/${template.id}/export`
      )
      const blob = new Blob([`${JSON.stringify(answer.data.data, null, 2)}\n`], {
        type: 'application/json',
      })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = templateFileName(template.name)
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message: problemOf(error)?.detail ?? t('template.gallery.export.failed'),
      })
    }
  }
}
