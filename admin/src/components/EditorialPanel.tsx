import { Box, Button, Flex, Link, Typography } from '@strapi/design-system'
import {
  unstable_useContentManagerContext,
  unstable_useDocument,
  useForm,
  useQueryParams,
} from '@strapi/strapi/admin'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import styled, { useTheme } from 'styled-components'

import { editorialOf } from '../hooks/useBuilderDocument'
import { useTransition, type TransitionOptions } from '../hooks/useTransition'
import { useMessages } from '../messages'
import { panelActions, stepsFor } from '../utils/editorialPanel'
import { hasPreview, type ActionSchema } from '../utils/previewAction'
import { builderPath, type EditorialState, type ReviewAction } from '../utils/review'
import { ScheduleDialog, SendBackDialog, SendToReviewDialog } from './builder/ReviewDialogs'

/** What Strapi hands a side panel of the edit view; the fields this panel reads. */
interface SidePanelProps {
  collectionType: string
  /** `undefined` while the entry is being created. */
  documentId?: string
  model: string
  /** The draft or the published version the form shows, with its components. */
  document?: Record<string, unknown>
  /** `null` when the type has no draft and publish, `'published'` while the form shows the live version. */
  activeTab: 'draft' | 'published' | null
}

/** The description Strapi renders as a panel of the edit view's side. */
interface SidePanelDescription {
  title: string
  content: JSX.Element
}

const Steps = styled.ol`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Step = styled.li`
  display: flex;
  align-items: center;
  gap: 6px;
`

/** The mark of a step: a tick when it is done, a filled dot when it is the current one, a ring ahead. */
function StepMark({ kind }: { kind: 'done' | 'current' | 'ahead' }) {
  const { colors } = useTheme()
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {kind === 'done' ? (
        <>
          <circle cx="8" cy="8" r="8" fill={colors.success600} />
          <path d="m5 8.2 2 2 4-4.2" fill="none" stroke={colors.neutral0} strokeWidth="1.6" />
        </>
      ) : kind === 'current' ? (
        <circle cx="8" cy="8" r="8" fill={colors.warning600} />
      ) : (
        <circle cx="8" cy="8" r="7.25" fill="none" stroke={colors.neutral400} strokeWidth="1.5" />
      )}
    </svg>
  )
}

/**
 * The editorial panel in the side of the edit view (issue #164): the steps of the workflow, the
 * buttons of the entry's state and the note of the last transition, for a type made with
 * `withEditorial`, whether or not it has a builder.
 *
 * @remarks
 * It shows for a saved entry of a collection type whose answer carries the `editorial` component,
 * on the draft; any other entry gets `null`. Strapi runs it as a hook, so the work is in
 * `EditorialPanelContent`, which the panel mounts. It is registered before the cost panel
 * (`admin/src/index.ts`), so it is the first panel of the core in the side.
 */
export function EditorialPanel({
  collectionType,
  documentId,
  model,
  document,
  activeTab,
}: SidePanelProps): SidePanelDescription | null {
  const { t } = useMessages()
  const { contentType } = unstable_useContentManagerContext()
  const facts = document ? editorialOf(document) : undefined
  // A transition acts on the draft: the live version has nothing to move.
  if (collectionType !== 'collection-types' || !documentId || !facts || activeTab === 'published') {
    return null
  }
  const locale = typeof document?.locale === 'string' ? document.locale : null
  const site = document?.site as { name?: unknown; slug?: unknown } | null | undefined
  const siteName = [site?.name, site?.slug].find(
    (value): value is string => typeof value === 'string' && value !== ''
  )
  return {
    title: t('editorial.panel.title'),
    content: (
      <EditorialPanelContent
        key={`${model}/${documentId}/${locale ?? ''}`}
        page={{ uid: model, documentId, locale }}
        collectionType={collectionType}
        state={facts.state}
        publishAt={facts.publishAt}
        note={facts.note}
        site={siteName ?? ''}
        hasBuilder={hasPreview(contentType as ActionSchema | undefined)}
      />
    ),
  }
}

interface ContentProps {
  page: { uid: string; documentId: string; locale: string | null }
  collectionType: string
  state: EditorialState
  publishAt: string | null
  note: string | null
  site: string
  hasBuilder: boolean
}

/** The panel's body: see {@link EditorialPanel}. */
export function EditorialPanelContent(props: ContentProps) {
  const { t, date } = useMessages()
  const { page, state } = props
  const { perform, notify } = useTransition(page)
  const isModified = useForm('EditorialPanel', (form) => form.modified)
  const [open, setOpen] = useState<ReviewAction['dialog']>()
  const [isWorking, setIsWorking] = useState(false)

  // The edit view reads the document through this query: asking it again moves the form and the
  // panel to the state the transition wrote, with no reload. The params are the edit view's own.
  const [{ query }] = useQueryParams<{ plugins?: Record<string, unknown> }>()
  const { plugins, ...rest } = query ?? {}
  const params = { ...rest, ...Object.assign({}, ...Object.values(plugins ?? {})) }
  const { refetch } = unstable_useDocument({
    collectionType: props.collectionType,
    model: page.uid,
    documentId: page.documentId,
    params,
  })

  const { steps, current } = stepsFor(state)
  const actions = panelActions(state)
  const isBlocked = Boolean(isModified) || isWorking
  const action = (dialog: ReviewAction['dialog']) => actions.find((item) => item.dialog === dialog)

  async function run(item: ReviewAction, options: TransitionOptions = {}): Promise<boolean> {
    setIsWorking(true)
    try {
      const outcome = await perform(item.to, options)
      if (outcome.ok) refetch()
      return outcome.ok
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={3} width="100%">
      <Steps aria-label={t('editorial.panel.steps')}>
        {steps.map((step, index) => {
          const kind =
            index < current || (index === current && state === 'published')
              ? 'done'
              : index === current
                ? 'current'
                : 'ahead'
          return (
            <Step key={step} aria-current={index === current ? 'step' : undefined}>
              <StepMark kind={kind} />
              <Typography
                variant="omega"
                fontWeight={index === current ? 'bold' : 'regular'}
                textColor={index === current ? 'neutral800' : 'neutral600'}
              >
                {t(`builder.state.${step}`)}
              </Typography>
            </Step>
          )
        })}
      </Steps>
      {state === 'scheduled' && props.publishAt ? (
        <Typography variant="pi" textColor="neutral600" tag="p">
          {t('editorial.panel.publishAt', { when: date(props.publishAt) })}
        </Typography>
      ) : null}
      {props.note ? (
        <Box background="neutral100" padding={3} hasRadius>
          <Typography variant="pi" fontWeight="bold" textColor="neutral600" tag="p">
            {t('editorial.panel.note')}
          </Typography>
          <Typography variant="pi" tag="p" style={{ whiteSpace: 'pre-wrap' }}>
            {props.note}
          </Typography>
        </Box>
      ) : null}
      <Flex direction="column" alignItems="stretch" gap={2}>
        {actions.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="M"
            fullWidth
            variant={item.isPrimary ? 'default' : 'secondary'}
            disabled={isBlocked}
            onClick={() => (item.dialog ? setOpen(item.dialog) : void run(item))}
          >
            {t(`review.action.${item.id}`)}
          </Button>
        ))}
      </Flex>
      {isModified ? (
        <Typography variant="pi" textColor="neutral600" tag="p" role="status">
          {t('editorial.panel.unsaved')}
        </Typography>
      ) : null}
      {props.hasBuilder ? (
        <Link tag={NavLink} to={builderPath(page)}>
          {t('editorial.panel.builder')}
        </Link>
      ) : null}
      {open === 'review' && action('review') ? (
        <SendToReviewDialog
          isIncomplete={undefined}
          site={props.site}
          budget={{ kind: 'loading' }}
          pageType=""
          perform={perform}
          notify={notify}
          onClose={() => setOpen(undefined)}
          onSend={(note) => run(action('review')!, { note })}
        />
      ) : null}
      {open === 'schedule' && action('schedule') ? (
        <ScheduleDialog
          onClose={() => setOpen(undefined)}
          onSchedule={(publishAt) => run(action('schedule')!, { publishAt })}
        />
      ) : null}
      {open === 'sendBack' && action('sendBack') ? (
        <SendBackDialog
          onClose={() => setOpen(undefined)}
          onSendBack={(note) => run(action('sendBack')!, { note })}
        />
      ) : null}
    </Flex>
  )
}
