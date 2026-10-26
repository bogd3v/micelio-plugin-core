import { unstable_useContentManagerContext, useAuth, useForm } from '@strapi/strapi/admin'
import { useNavigate } from 'react-router-dom'

import { useMessages } from '../messages'
import { PREVIEW_PERMISSION } from '../permissions'
import { hasPreview, previewPagePath, type ActionSchema } from '../utils/previewAction'
import { EyeIcon } from './EyeIcon'

/** What Strapi hands a header action of the edit view; the fields this action reads. */
interface HeaderActionProps {
  collectionType: string
  /** `undefined` while the entry is being created. */
  documentId?: string
  document?: { locale?: string | null }
}

/** The description Strapi renders as a button of the edit view's header. */
interface HeaderActionDescription {
  label: string
  icon: JSX.Element
  disabled: boolean
  onClick: () => void
}

/**
 * The **Preview** button in the header of the edit view (issue #47): it opens the preview page of the
 * entry. Strapi runs it as a hook, once for each edit view, and shows what it returns.
 *
 * @remarks
 * It shows only for a saved entry of a collection type that has a preview (`hasPreview`) to a role
 * that may preview. While the form has unsaved changes it is disabled, and its label, which is also
 * its tooltip and its accessible name, says to save first: the preview shows the saved draft.
 * The name of the function is what Strapi keys the button by.
 */
export function PreviewHeaderAction({
  collectionType,
  documentId,
  document,
}: HeaderActionProps): HeaderActionDescription | null {
  const { t } = useMessages()
  const navigate = useNavigate()
  const { contentType } = unstable_useContentManagerContext()
  const permissions = useAuth('PreviewHeaderAction', (state) => state.permissions)
  const isModified = useForm('PreviewHeaderAction', (state) => state.modified)
  const mayPreview = permissions.some(({ action }) => action === PREVIEW_PERMISSION.action)

  if (
    collectionType !== 'collection-types' ||
    !documentId ||
    !mayPreview ||
    !hasPreview(contentType as ActionSchema | undefined)
  ) {
    return null
  }
  const uid = contentType?.uid ?? ''
  return {
    label: t(isModified ? 'action.preview.unsaved' : 'action.preview'),
    icon: <EyeIcon />,
    disabled: Boolean(isModified),
    onClick: () => navigate(previewPagePath(uid, documentId, document?.locale ?? null)),
  }
}
