import { Badge, Box, Button, Field, Flex, Modal, Textarea, Typography } from '@strapi/design-system'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useIntl } from 'react-intl'
import styled, { useTheme } from 'styled-components'

import type { BudgetResource } from '../../hooks/useBudget'
import type { TransitionOptions, TransitionOutcome } from '../../hooks/useTransition'
import { useMessages } from '../../messages'
import { instantOf, toLocalInput, transitionNotice, type EditorialState } from '../../utils/review'
import { Input } from './fieldStyle'

// The dialogs of the editorial buttons, shared by the builder's toolbar (`ReviewActions`), the In
// review page and the edit view's side panel (`EditorialPanel`).

const Label = styled.label`
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.neutral800};
`

const Pair = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
`

/** A round mark before a line of the checklist: a tick on success, an exclamation on a warning. */
export function Mark({ tone }: { tone: 'success' | 'warning' }) {
  const { colors } = useTheme()
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle
        cx="8"
        cy="8"
        r="8"
        fill={tone === 'success' ? colors.success600 : colors.warning600}
      />
      {tone === 'success' ? (
        <path d="m5 8.2 2 2 4-4.2" fill="none" stroke={colors.neutral0} strokeWidth="1.6" />
      ) : (
        <path d="M8 4.5v4.2M8 11v.5" fill="none" stroke={colors.neutral0} strokeWidth="1.8" />
      )}
    </svg>
  )
}

export function Check({ tone, children }: { tone: 'success' | 'warning'; children: ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 8, alignItems: 'flex-start', listStyle: 'none' }}>
      <span style={{ flex: '0 0 16px', marginTop: 2 }}>
        <Mark tone={tone} />
      </span>
      <Typography>{children}</Typography>
    </li>
  )
}

/** What the send to review dialog reads of the page it is sending. */
export interface SendToReviewProps {
  /**
   * Whether a block lacks a required field: the dialog says so. `undefined` for a page the caller
   * cannot read the blocks of (the edit view's panel): the dialog then lists no such check.
   */
  isIncomplete: boolean | undefined
  /** The site's name for the dialog, its slug when it has none. */
  site: string
  budget: BudgetResource
  /** The page type, for the budget line: `landing`. */
  pageType: string
  perform: (to: EditorialState, options?: TransitionOptions) => Promise<TransitionOutcome>
  notify: (problem: unknown) => void
}

function Dialog(props: {
  title: string
  onClose: () => void
  footer: ReactNode
  children: ReactNode
}) {
  const { t } = useMessages()
  return (
    <Modal.Root open onOpenChange={(isOpen: boolean) => (isOpen ? undefined : props.onClose())}>
      <Modal.Content style={{ width: 'min(440px, 100vw)' }}>
        <Modal.Header closeLabel={t('review.dialog.close')}>
          <Modal.Title>{props.title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{props.children}</Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">{t('review.dialog.cancel')}</Button>
          </Modal.Close>
          {props.footer}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  )
}

/** Send to review: the dry run's checks and warnings, and a note for the reviewer. */
export function SendToReviewDialog(
  props: SendToReviewProps & { onClose: () => void; onSend: (note: string) => Promise<boolean> }
) {
  const { t, kb } = useMessages()
  const { locale } = useIntl()
  // The dry run runs once, when the dialog opens: the callbacks are read from a ref.
  const latest = useRef(props)
  latest.current = props
  const [warnings, setWarnings] = useState<unknown[]>()
  const [note, setNote] = useState('')
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    let isCurrent = true
    void latest.current.perform('in_review', { dryRun: true }).then((outcome) => {
      if (!isCurrent) return
      if (outcome.ok) {
        setWarnings(outcome.warnings)
      } else {
        // A check refused it: the notification says which block, and there is nothing to send.
        latest.current.notify(outcome.problem)
        latest.current.onClose()
      }
    })
    return () => {
      isCurrent = false
    }
  }, [])

  const measurement = props.budget.kind === 'ready' ? props.budget.measurement : undefined
  const hasWarnings = (warnings?.length ?? 0) > 0
  return (
    <Dialog
      title={t('review.send.title')}
      onClose={props.onClose}
      footer={
        <Button
          disabled={warnings === undefined || isSending}
          loading={isSending}
          onClick={async () => {
            setIsSending(true)
            const isSent = await props.onSend(note)
            setIsSending(false)
            if (isSent) props.onClose()
          }}
        >
          {t(hasWarnings ? 'review.send.anyway' : 'review.send.submit')}
        </Button>
      }
    >
      {warnings === undefined ? (
        <Typography textColor="neutral600">{t('review.send.checking')}</Typography>
      ) : (
        <Flex direction="column" alignItems="stretch" gap={5}>
          <ul
            aria-label={t('review.send.checks')}
            style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 0, margin: 0 }}
          >
            {props.isIncomplete === undefined ? null : (
              <Check tone={props.isIncomplete ? 'warning' : 'success'}>
                {t(props.isIncomplete ? 'review.check.incomplete' : 'review.check.fields')}
              </Check>
            )}
            <Check tone="success">{t('review.check.server')}</Check>
            {measurement ? (
              <Check tone={measurement.overByKb > 0 ? 'warning' : 'success'}>
                {t(measurement.overByKb > 0 ? 'review.check.overBudget' : 'review.check.budget', {
                  weight: kb(measurement.blocksKb),
                  budget: kb(measurement.budgetKb),
                  pageType: props.pageType,
                })}
              </Check>
            ) : null}
            {warnings.map((warning, index) => {
              const notice = transitionNotice(warning, locale)
              return (
                <Check key={index} tone="warning">
                  {t(notice.message, notice.values)}
                </Check>
              )
            })}
          </ul>
          <Field.Root name="note" hint={t('review.send.reviewers', { site: props.site })}>
            <Field.Label>
              {t('review.send.note')}{' '}
              <Typography textColor="neutral600" fontWeight="regular">
                {t('review.optional')}
              </Typography>
            </Field.Label>
            <Textarea
              placeholder={t('review.send.placeholder')}
              value={note}
              maxLength={1000}
              onChange={(event: { target: { value: string } }) => setNote(event.target.value)}
            />
            <Field.Hint />
          </Field.Root>
        </Flex>
      )}
    </Dialog>
  )
}

/** Schedule publication: a date and time in the editor's time zone, and what scheduling means. */
export function ScheduleDialog(props: {
  onClose: () => void
  onSchedule: (publishAt: string) => Promise<boolean>
}) {
  const { t } = useMessages()
  const tomorrow = toLocalInput(new Date(Date.now() + 24 * 3_600_000))
  const [date, setDate] = useState(tomorrow.slice(0, 10))
  const [time, setTime] = useState('08:00')
  const [isSending, setIsSending] = useState(false)
  const publishAt = instantOf(date, time)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return (
    <Dialog
      title={t('review.schedule.title')}
      onClose={props.onClose}
      footer={
        <Button
          disabled={!publishAt || isSending}
          loading={isSending}
          onClick={async () => {
            if (!publishAt) return
            setIsSending(true)
            const isDone = await props.onSchedule(publishAt)
            setIsSending(false)
            if (isDone) props.onClose()
          }}
        >
          {t('review.schedule.submit')}
        </Button>
      }
    >
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Pair>
          <div>
            <Label htmlFor="schedule-date">{t('review.schedule.date')}</Label>
            <Input
              id="schedule-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="schedule-time">{t('review.schedule.time')}</Label>
            <Input
              id="schedule-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </div>
        </Pair>
        <Typography variant="pi" textColor="neutral600" tag="p">
          {t('review.schedule.zone', { zone })}
        </Typography>
        <Box background="neutral100" padding={3} hasRadius>
          <Flex gap={2} alignItems="center" wrap="wrap">
            <Typography fontWeight="bold">{t('review.schedule.after')}</Typography>
            <Badge backgroundColor="primary100" textColor="primary600">
              {t('review.state.scheduled')}
            </Badge>
            <Typography variant="pi" textColor="neutral600">
              {t('review.schedule.editable')}
            </Typography>
          </Flex>
          <Typography variant="pi" textColor="neutral600" tag="p">
            {t('review.schedule.reset')}
          </Typography>
        </Box>
      </Flex>
    </Dialog>
  )
}

/** Send back: the reviewer's note for the editor; the page goes back to draft. The In review page uses it too. */
export function SendBackDialog(props: {
  onClose: () => void
  onSendBack: (note: string) => Promise<boolean>
}) {
  const { t } = useMessages()
  const [note, setNote] = useState('')
  const [isSending, setIsSending] = useState(false)
  return (
    <Dialog
      title={t('review.back.title')}
      onClose={props.onClose}
      footer={
        <Button
          disabled={isSending}
          loading={isSending}
          onClick={async () => {
            setIsSending(true)
            const isDone = await props.onSendBack(note)
            setIsSending(false)
            if (isDone) props.onClose()
          }}
        >
          {t('review.back.submit')}
        </Button>
      }
    >
      <Field.Root name="note" hint={t('review.back.hint')}>
        <Field.Label>{t('review.back.note')}</Field.Label>
        <Textarea
          placeholder={t('review.back.placeholder')}
          value={note}
          maxLength={1000}
          onChange={(event: { target: { value: string } }) => setNote(event.target.value)}
        />
        <Field.Hint />
      </Field.Root>
    </Dialog>
  )
}
