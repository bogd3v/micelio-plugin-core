import { Box, Button, Flex, Typography } from '@strapi/design-system'
import styled, { useTheme } from 'styled-components'

import type { BudgetResource } from '../hooks/useBudget'
import { useMessages } from '../messages'
import { meterLevel, meterPercent, onDemandBlocks, type MeterLevel } from '../utils/costMeter'

// The bar changes colour at 90 % and past 100 %, never along the way. The words say the same, so
// the colour is never the only signal (WCAG 1.4.1); the fills hold 3:1 against the track (1.4.11).
const FILL: Record<MeterLevel, string> = { ok: '#2e7d4f', near: '#a85a00', over: '#c0291f' }

const Track = styled.div`
  height: 0.75rem;
  border-radius: 0.375rem;
  background: #dcdce4;
  overflow: hidden;
`

const Fill = styled.div<{ $level: MeterLevel; $percent: number }>`
  height: 100%;
  width: ${(props) => props.$percent}%;
  background: ${(props) => FILL[props.$level]};
`

// The toolbar meter of the builder (the Builder artboard): the fill moves with the slow token, and
// the colour changes at the thresholds, not along the way.
const CompactTrack = styled.div`
  height: 6px;
  border-radius: 3px;
  background: ${({ theme }) => theme.colors.neutral150};
  overflow: hidden;
`

const CompactFill = styled.div<{ $level: MeterLevel; $percent: number }>`
  height: 100%;
  width: ${(props) => props.$percent}%;
  background: ${({ $level, theme }) =>
    $level === 'ok'
      ? theme.colors.success600
      : $level === 'near'
        ? theme.colors.warning600
        : theme.colors.danger600};
  transition: width var(--m-slow, 320ms) var(--m-ease, cubic-bezier(0.2, 0, 0, 1));
`

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  th,
  td {
    padding: 0.25rem 0.5rem 0.25rem 0;
    text-align: left;
    border-bottom: 1px solid #eaeaef;
  }
  td:nth-child(n + 3),
  th:nth-child(n + 3) {
    text-align: right;
  }
`

/** What the cost meter says of the page's standing, in words. */
function standing(
  { t, kb }: Pick<ReturnType<typeof useMessages>, 't' | 'kb'>,
  level: MeterLevel,
  blocksKb: number,
  budgetKb: number,
  overByKb: number
): string {
  if (level === 'over') return t('cost.level.over', { over: kb(overByKb) })
  if (level === 'near') return t('cost.level.near', { left: kb(budgetKb - blocksKb) })
  return t('cost.level.ok')
}

/**
 * The cost meter of the preview pane: the weight of the page's blocks against its budget, the framework's share apart, the on-demand weight
 * apart, and the weight of each block on expand (issues #46 and #106).
 *
 * @remarks
 * It shows the report the admin read from the frontend with the editor's grant and the plugin placed
 * against the budget (`useBudget`); it never estimates. A type
 * with no budget (`unsupported`) shows nothing.
 */
export function CostMeter(props: {
  resource: BudgetResource
  onMeasureAgain: () => void
  /** The one-line meter of the builder's toolbar, instead of the card of the preview pane. */
  isCompact?: boolean
}) {
  const { t } = useMessages()
  const { resource, onMeasureAgain } = props
  if (resource.kind === 'error' && resource.reason === 'unsupported') return null
  if (props.isCompact) return <CompactMeter resource={resource} />
  return (
    <Box
      tag="section"
      aria-labelledby="micelio-cost-title"
      marginTop={6}
      padding={4}
      hasRadius
      borderColor="neutral200"
      background="neutral0"
    >
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Typography variant="delta" tag="h2" id="micelio-cost-title">
          {t('cost.title')}
        </Typography>
        {resource.kind === 'loading' ? (
          <Typography role="status" textColor="neutral700">
            {t('cost.loading')}
          </Typography>
        ) : null}
        {resource.kind === 'error' ? (
          <>
            <Typography role="alert">{t(`cost.error.${resource.reason}`)}</Typography>
            <Flex>
              <Button type="button" size="S" variant="tertiary" onClick={onMeasureAgain}>
                {t('cost.measureAgain')}
              </Button>
            </Flex>
          </>
        ) : null}
        {resource.kind === 'ready' ? (
          <Measured measurement={resource.measurement} onMeasureAgain={onMeasureAgain} />
        ) : null}
      </Flex>
    </Box>
  )
}

function Measured(props: {
  measurement: Extract<BudgetResource, { kind: 'ready' }>['measurement']
  onMeasureAgain: () => void
}) {
  const { t, date, kb } = useMessages()
  const { measurement, onMeasureAgain } = props
  const { blocksKb, frameworkKb, budgetKb, overByKb, onDemandKb } = measurement
  const level = meterLevel(blocksKb, budgetKb)
  const text = standing({ t, kb }, level, blocksKb, budgetKb, overByKb)
  const line = t('cost.line', { total: kb(blocksKb), budget: kb(budgetKb) })
  const heavy = onDemandBlocks(measurement.blocks)
  return (
    <>
      <Typography variant="beta" tag="p" data-testid="cost-line">
        {line}
      </Typography>
      <div
        role="meter"
        aria-label={t('cost.meter')}
        aria-valuemin={0}
        aria-valuemax={budgetKb}
        aria-valuenow={Math.min(blocksKb, budgetKb)}
        aria-valuetext={`${line}. ${text}`}
        data-level={level}
        data-testid="cost-meter"
      >
        <Track>
          <Fill $level={level} $percent={meterPercent(blocksKb, budgetKb)} />
        </Track>
      </div>
      <Typography tag="p" fontWeight="bold" data-testid="cost-standing">
        {text}
      </Typography>
      <Typography textColor="neutral700" tag="p">
        {t('cost.pageType', { type: measurement.pageType })}
      </Typography>
      <Typography textColor="neutral700" tag="p" data-testid="cost-framework">
        {t('cost.framework', { kb: kb(frameworkKb) })}
      </Typography>
      <Typography textColor="neutral700" tag="p" data-testid="cost-on-demand">
        {t('cost.onDemand', { kb: kb(onDemandKb) })}
      </Typography>
      <details>
        <summary>{t('cost.details')}</summary>
        <Table aria-label={t('cost.details')}>
          <thead>
            <tr>
              <th scope="col">{t('cost.column.position')}</th>
              <th scope="col">{t('cost.column.block')}</th>
              <th scope="col">{t('cost.column.weight')}</th>
              <th scope="col">{t('cost.column.onDemand')}</th>
            </tr>
          </thead>
          <tbody>
            {measurement.blocks.map((block) => (
              <tr key={block.position}>
                <td>{block.position}</td>
                <td>{block.id}</td>
                <td>{kb(block.kb)}</td>
                <td>{block.onDemandKb > 0 ? kb(block.onDemandKb) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {heavy.length === 0 ? null : (
          <Typography textColor="neutral700" tag="p">
            {t('cost.onDemandBlocks', { blocks: heavy.map((block) => block.id).join(', ') })}
          </Typography>
        )}
      </details>
      <Typography textColor="neutral700" tag="p">
        {t('cost.measuredAt', { date: date(measurement.measuredAt) })}
      </Typography>
      <Flex>
        <Button type="button" size="S" variant="tertiary" onClick={onMeasureAgain}>
          {t('cost.measureAgain')}
        </Button>
      </Flex>
    </>
  )
}

/** The meter of the builder's toolbar: the same measurement and thresholds as the card, in one line. */
function CompactMeter({ resource }: { resource: BudgetResource }) {
  const { colors } = useTheme()
  const { t, kb } = useMessages()
  if (resource.kind !== 'ready') {
    return (
      <div
        style={{ width: 160, fontSize: 12 }}
        role={resource.kind === 'error' ? 'alert' : 'status'}
      >
        {t(resource.kind === 'error' ? 'builder.meter.error' : 'builder.meter.loading')}
      </div>
    )
  }
  const { blocksKb, budgetKb } = resource.measurement
  const level = meterLevel(blocksKb, budgetKb)
  const used = kb(blocksKb)
  const budget = kb(budgetKb)
  // Islands load their script only once used: it is not in the weight, and the line says how many.
  const onDemand = onDemandBlocks(resource.measurement.blocks).length
  return (
    <div style={{ width: 160 }} data-testid="toolbar-meter">
      <div
        style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}
      >
        <span>{t('builder.meter.title')}</span>
        <span>{t('builder.meter.value', { used, budget })}</span>
      </div>
      <div
        role="meter"
        aria-label={t('builder.meter.label', { used, budget })}
        aria-valuemin={0}
        aria-valuemax={budgetKb}
        aria-valuenow={Math.min(blocksKb, budgetKb)}
        aria-valuetext={t(`cost.level.${level}`, {
          over: kb(resource.measurement.overByKb),
          left: kb(budgetKb - blocksKb),
        })}
        data-level={level}
      >
        <CompactTrack>
          <CompactFill $level={level} $percent={meterPercent(blocksKb, budgetKb)} />
        </CompactTrack>
      </div>
      {onDemand > 0 ? (
        <div
          data-testid="toolbar-on-demand"
          style={{ fontSize: 11, marginTop: 2, color: colors.secondary600 }}
        >
          {t('builder.meter.onDemand', { count: onDemand })}
        </div>
      ) : null}
    </div>
  )
}
