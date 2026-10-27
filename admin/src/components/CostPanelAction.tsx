import { unstable_useContentManagerContext, useAuth } from '@strapi/strapi/admin'

import { useMessages } from '../messages'
import { PREVIEW_PERMISSION } from '../permissions'
import { hasPreview, type ActionSchema } from '../utils/previewAction'
import { CostPanelContent } from './CostPanel'

/** What Strapi hands a side panel of the edit view; the fields this panel reads. */
interface SidePanelProps {
  collectionType: string
  /** `undefined` while the entry is being created. */
  documentId?: string
  model: string
  document?: { locale?: string | null; updatedAt?: string | null }
}

/** The description Strapi renders as a panel of the edit view's side. */
interface SidePanelDescription {
  title: string
  content: JSX.Element
}

/**
 * The cost line in the side panel of the edit view (issue #106): what the saved draft's blocks weigh
 * against its budget, and when that was measured.
 *
 * @remarks
 * It shows for the entries that have the **Preview** button (`hasPreview`) to a role that may
 * preview. A type that is not measured against a budget says so in the panel. Strapi runs it as a
 * hook, so the work is in `CostPanelContent`, which the panel mounts.
 */
export function CostPanel({
  collectionType,
  documentId,
  model,
  document,
}: SidePanelProps): SidePanelDescription | null {
  const { t } = useMessages()
  const { contentType } = unstable_useContentManagerContext()
  const permissions = useAuth('CostPanel', (state) => state.permissions)
  const mayPreview = permissions.some(({ action }) => action === PREVIEW_PERMISSION.action)
  if (
    collectionType !== 'collection-types' ||
    !documentId ||
    !mayPreview ||
    !hasPreview(contentType as ActionSchema | undefined)
  ) {
    return null
  }
  return {
    title: t('cost.title'),
    content: (
      <CostPanelContent
        key={`${model}/${documentId}/${document?.locale ?? ''}`}
        entry={{
          uid: model,
          documentId,
          locale: document?.locale ?? null,
          version: document?.updatedAt ?? undefined,
        }}
      />
    ),
  }
}
