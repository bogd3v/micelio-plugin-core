import { Button, Flex, Link, Typography } from '@strapi/design-system'
import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'

import type { BudgetMeasurement } from '../../../server/src/types/budget'
import { useBudget, type BudgetError } from '../hooks/useBudget'
import { usePreviewSource, type PreviewSourceError } from '../hooks/usePreviewSource'
import { useMessages } from '../messages'
import { formatKb, isSameVersion, meterLevel, weightRoute } from '../utils/costMeter'
import { previewPagePath } from '../utils/previewAction'
import { PreviewFrame, type FrameState } from './PreviewFrame'

/** What the panel needs of the entry. */
export interface CostPanelEntry {
  uid: string
  documentId: string
  /** `null` for a type that is not localised. */
  locale: string | null
  /** The draft's `updatedAt`: a measurement of an earlier one is said to be from before the last save. */
  version: string | undefined
}

// The panel cannot say more than the preview page can: these are the texts of the page's meter.
const SOURCE_TEXT: Record<PreviewSourceError, string> = {
  unavailable: 'cost.panel.noSite',
  forbidden: 'cost.error.forbidden',
  busy: 'cost.error.busy',
  missing: 'cost.error.failed',
  unsupported: 'cost.error.failed',
  failed: 'cost.error.failed',
  popup: 'cost.error.failed',
}

const NO_FRAME: FrameState = { protocol: 'waiting', versions: [], isBusy: false, isSilent: false }

const budgetText = (reason: BudgetError) =>
  reason === 'unsupported' ? 'cost.panel.unsupported' : `cost.error.${reason}`

/** How one run of the measurement ended: the weight, or the id of the text that says why not. */
type Outcome = { kind: 'ready'; measurement: BudgetMeasurement } | { kind: 'error'; text: string }

/**
 * One measurement: gets the editor's grant with a frame that is never shown, reads the weight route
 * with it and reports the outcome once. The parent unmounts it then, so the frame is gone and no
 * new token is asked for.
 */
function Measurement({
  entry,
  onSettled,
}: {
  entry: CostPanelEntry
  onSettled: (outcome: Outcome) => void
}) {
  const { t } = useMessages()
  const { uid, documentId, locale, version } = entry
  const { source } = usePreviewSource({ uid, documentId, locale }, 'live')
  const [frame, setFrame] = useState<FrameState>(NO_FRAME)
  const [isBlocked, setIsBlocked] = useState(false)
  const weightUrl =
    source.kind === 'ready' && frame.protocol === 'ok'
      ? weightRoute(source.src, uid, documentId, locale)
      : undefined
  const { resource } = useBudget(uid, documentId, locale, version, weightUrl)

  let outcome: Outcome | undefined
  if (source.kind === 'error') outcome = { kind: 'error', text: SOURCE_TEXT[source.reason] }
  else if (isBlocked) outcome = { kind: 'error', text: 'cost.panel.blocked' }
  else if (frame.isSilent || frame.protocol === 'upgrade') {
    outcome = { kind: 'error', text: 'cost.panel.silent' }
  } else if (resource.kind === 'error') {
    outcome = { kind: 'error', text: budgetText(resource.reason) }
  } else if (resource.kind === 'ready')
    outcome = { kind: 'ready', measurement: resource.measurement }

  const settled = useRef(onSettled)
  settled.current = onSettled
  useEffect(() => {
    if (outcome) settled.current(outcome)
    // `outcome` is rebuilt on every render; it is a function of the values below.
  }, [resource, source, frame.isSilent, frame.protocol, isBlocked])

  if (source.kind !== 'ready') return null
  return (
    <div hidden>
      <PreviewFrame
        src={source.src}
        origin={source.origin}
        documentId={documentId}
        locale={locale}
        title={t('cost.panel.frame')}
        width={1280}
        onChange={setFrame}
        onBlocked={() => setIsBlocked(true)}
        isCovered
      />
    </div>
  )
}

/**
 * The cost line of the edit view's side panel: the weight of the saved draft's blocks against its
 * budget ("4.4 kB of 60 kB"), the time it was measured, a **Measure** button and a link to the
 * preview page, which has the whole meter (issue #106).
 *
 * @remarks
 * The panel measures on demand. Opening an entry renders nothing on the frontend and asks for no
 * token; pressing **Measure** asks for the editor's own grant, loads the site in a frame that is never
 * shown (`hidden`), reads the weight route with the cookie that frame set (`useBudget`) and drops the
 * frame again. It never estimates, and it does not measure by itself after a save: the last
 * measurement stays, marked as made before the last save when the draft has changed since.
 */
export function CostPanelContent({ entry }: { entry: CostPanelEntry }) {
  const { t, date } = useMessages()
  const { uid, documentId, locale, version } = entry
  const [run, setRun] = useState(0)
  const [isMeasuring, setIsMeasuring] = useState(false)
  const [last, setLast] = useState<BudgetMeasurement>()
  const [failure, setFailure] = useState<string>()

  const settle = useCallback((outcome: Outcome) => {
    setIsMeasuring(false)
    if (outcome.kind === 'ready') {
      setFailure(undefined)
      setLast(outcome.measurement)
    } else setFailure(outcome.text)
  }, [])
  const measure = () => {
    setFailure(undefined)
    setIsMeasuring(true)
    setRun((value) => value + 1)
  }

  let body: JSX.Element | null = null
  if (last) {
    const { blocksKb, budgetKb, overByKb, measuredAt } = last
    const level = meterLevel(blocksKb, budgetKb)
    body = (
      <Flex direction="column" alignItems="stretch" gap={1}>
        <Typography variant="delta" tag="p" data-testid="cost-line" data-level={level}>
          {t('cost.line', { total: formatKb(blocksKb), budget: formatKb(budgetKb) })}
        </Typography>
        <Typography tag="p" fontWeight="bold" data-testid="cost-standing">
          {level === 'over'
            ? t('cost.level.over', { over: formatKb(overByKb) })
            : level === 'near'
              ? t('cost.level.near', { left: formatKb(budgetKb - blocksKb) })
              : t('cost.level.ok')}
        </Typography>
        <Typography textColor="neutral700" tag="p" data-testid="cost-measured-at">
          {t('cost.measuredAt', { date: date(measuredAt) })}{' '}
          {isSameVersion(last.version, version) ? t('cost.panel.saved') : t('cost.panel.stale')}
        </Typography>
      </Flex>
    )
  } else if (!isMeasuring && !failure) {
    body = (
      <Typography textColor="neutral700" tag="p" data-testid="cost-never">
        {t('cost.panel.never')}
      </Typography>
    )
  }

  const isUnsupported = failure === 'cost.panel.unsupported'
  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      {body}
      {isMeasuring ? (
        <Typography role="status" textColor="neutral700">
          {t('cost.loading')}
        </Typography>
      ) : null}
      {failure ? <Typography role="alert">{t(failure)}</Typography> : null}
      {isUnsupported ? null : (
        <Button variant="secondary" onClick={measure} disabled={isMeasuring}>
          {t(last || failure ? 'cost.measureAgain' : 'cost.panel.measure')}
        </Button>
      )}
      {isUnsupported || failure === 'cost.panel.noSite' ? null : (
        <Link tag={NavLink} to={previewPagePath(uid, documentId, locale)}>
          {t('cost.panel.open')}
        </Link>
      )}
      {run > 0 && isMeasuring ? <Measurement key={run} entry={entry} onSettled={settle} /> : null}
    </Flex>
  )
}
