import { useNotification } from '@strapi/strapi/admin'
import { useEffect } from 'react'

import { useMessages } from '../messages'
import type { BuilderState } from './useBuilderDocument'

/**
 * Tells the editor why the server refused a save, as a notification of the admin, once for each
 * refusal. The link to the block it names is in the page itself (`BuilderPage`): a notification's
 * link opens a new tab, which would read the saved draft, where a block that was refused is not.
 *
 * @remarks
 * The refusal is the server's problem detail (`blockOptionInvalid`, `blockNotAllowed`), read from
 * the error of the Content Manager's route; the text is the server's `detail`.
 */
export function useRefusalNotice(state: BuilderState): void {
  const { t } = useMessages()
  const { toggleNotification } = useNotification()
  useEffect(() => {
    const refusal = state.refusal
    if (!refusal) return
    toggleNotification({
      type: 'danger',
      title: t('builder.refusal.title'),
      message: refusal.detail || t('builder.refusal.failed'),
      timeout: 15_000,
    })
  }, [state.refusal])
}
