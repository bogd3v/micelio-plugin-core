import { Button } from '@strapi/design-system'
import { useEffect, useRef, useState } from 'react'

import type { BudgetResource } from '../../hooks/useBudget'
import type { TransitionOptions, TransitionOutcome } from '../../hooks/useTransition'
import { useSiteTimeZone } from '../../hooks/useSiteTimeZone'
import { useMessages } from '../../messages'
import { actionsFor, type EditorialState, type ReviewAction } from '../../utils/review'
import { ScheduleDialog, SendBackDialog, SendToReviewDialog } from './ReviewDialogs'

interface ReviewActionsProps {
  /** The page, for the time zone of its site. */
  page: { uid: string; documentId: string; locale: string | null }
  state: EditorialState
  /** Whether the page holds changes that are not saved yet: the server checks the saved draft. */
  isBusy: boolean
  /** Whether a block lacks a required field: the send to review dialog says so. */
  isIncomplete: boolean
  /** The site's name for the dialogs, its slug when it has none. */
  site: string
  budget: BudgetResource
  /** The page type, for the budget line: `landing`. */
  pageType: string
  perform: (to: EditorialState, options?: TransitionOptions) => Promise<TransitionOutcome>
  notify: (problem: unknown) => void
  /** Called once a transition went through: the page reads the draft again. */
  onMoved: () => void
  /** Asks the toolbar to open the schedule dialog, for the notice of a reset schedule. */
  scheduleRequest: number
  /** Asks the toolbar to open the send to review dialog, for ⌘↵: counts up, 0 for never. */
  reviewRequest: number
}

const isReview = (item: ReviewAction): boolean => item.dialog === 'review'

/**
 * The editorial buttons of the builder's toolbar (the Review flow artboard): send to review, schedule,
 * publish, send back, unschedule and unpublish, as the page's state offers them, with the dialogs of
 * send to review, schedule and send back.
 *
 * @remarks
 * Every button asks `POST /micelio/transitions`, which decides (ADR-0017, section 5): a refusal is a
 * notification with a link to the block it names (`useTransition`). Send to review asks for a dry
 * run first and lists its warnings (`linkToDraft`) before the editor sends.
 */
export function ReviewActions(props: ReviewActionsProps) {
  const { t } = useMessages()
  const [open, setOpen] = useState<ReviewAction['dialog']>()
  const [isWorking, setIsWorking] = useState(false)
  const siteZone = useSiteTimeZone(props.page)

  useEffect(() => {
    if (props.scheduleRequest > 0) setOpen('schedule')
  }, [props.scheduleRequest])

  // The key does what the button does: nothing while the page is busy or has no such button.
  const canReview = !props.isBusy && !isWorking && actionsFor(props.state).some(isReview)
  const canReviewRef = useRef(canReview)
  canReviewRef.current = canReview
  useEffect(() => {
    if (props.reviewRequest > 0 && canReviewRef.current) setOpen('review')
  }, [props.reviewRequest])

  async function run(action: ReviewAction, options: TransitionOptions = {}): Promise<boolean> {
    setIsWorking(true)
    try {
      const outcome = await props.perform(action.to, options)
      if (outcome.ok) props.onMoved()
      return outcome.ok
    } finally {
      setIsWorking(false)
    }
  }

  const actions = actionsFor(props.state)
  const action = (dialog: ReviewAction['dialog']) => actions.find((item) => item.dialog === dialog)
  return (
    <>
      {actions.map((item) => (
        <Button
          key={item.id}
          type="button"
          size="M"
          variant={item.isPrimary ? 'default' : 'tertiary'}
          disabled={props.isBusy || isWorking}
          onClick={() => (item.dialog ? setOpen(item.dialog) : void run(item))}
        >
          {t(`review.action.${item.id}`)}
        </Button>
      ))}
      {open === 'review' && action('review') ? (
        <SendToReviewDialog
          {...props}
          onClose={() => setOpen(undefined)}
          onSend={(note) => run(action('review')!, { note })}
        />
      ) : null}
      {open === 'schedule' && action('schedule') && !siteZone.isLoading ? (
        <ScheduleDialog
          zone={siteZone.zone}
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
    </>
  )
}
