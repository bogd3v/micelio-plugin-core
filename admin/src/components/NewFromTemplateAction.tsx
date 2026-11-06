import { unstable_useContentManagerContext } from '@strapi/strapi/admin'
import { useNavigate } from 'react-router-dom'

import { useMessages } from '../messages'
import { galleryPagePath, hasTemplates, type ActionSchema } from '../utils/templateAction'
import { MicelioIcon } from './MicelioIcon'

/** What Strapi hands a header action of the edit view; the fields this action reads. */
interface HeaderActionProps {
  collectionType: string
  /** `undefined` while the entry is being created. */
  documentId?: string
}

/** The description Strapi renders as a button of the edit view's header. */
interface HeaderActionDescription {
  label: string
  icon: JSX.Element
  onClick: () => void
}

/**
 * The **New page from a template** button in the header of the create view (issue #54): it opens the
 * gallery of templates of the page type, where a page is made from one and opened in the builder.
 *
 * @remarks
 * It shows only while a page is being created, for a collection type made with `withPageSettings`
 * (`hasTemplates`). The name of the function is what Strapi keys the button by.
 */
export function NewFromTemplateAction({
  collectionType,
  documentId,
}: HeaderActionProps): HeaderActionDescription | null {
  const { t } = useMessages()
  const navigate = useNavigate()
  const { contentType } = unstable_useContentManagerContext()
  if (
    collectionType !== 'collection-types' ||
    documentId ||
    !hasTemplates(contentType as ActionSchema | undefined)
  ) {
    return null
  }
  return {
    label: t('action.newFromTemplate'),
    icon: <MicelioIcon />,
    onClick: () => navigate(galleryPagePath(contentType?.uid ?? '')),
  }
}
