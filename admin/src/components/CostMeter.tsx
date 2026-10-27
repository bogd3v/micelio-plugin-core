import { Box, Button, Flex, Typography } from '@strapi/design-system'
import styled from 'styled-components'

import type { BudgetResource } from '../hooks/useBudget'
import { useMessages } from '../messages'
import {
  formatKb,
  meterLevel,
  meterPercent,
  onDemandBlocks,
  type MeterLevel,
} from '../utils/costMeter'

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
  t: ReturnType<typeof useMessages>['t'],
  level: MeterLevel,
  blocksKb: number,
  budgetKb: number,
  overByKb: number
): string {
  if (level === 'over') return t('cost.level.over', { over: formatKb(overByKb) })
  if (level === 'near') return t('cost.level.near', { left: formatKb(budgetKb - blocksKb) })
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
export function CostMeter(props: { resource: BudgetResource; onMeasureAgain: () => void }) {
  const { t } = useMessages()
  const { resource, onMeasureAgain } = props
  if (resource.kind === 'error' && resource.reason === 'unsupported') return null
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
  const { t, date } = useMessages()
  const { measurement, onMeasureAgain } = props
  const { blocksKb, frameworkKb, budgetKb, overByKb, onDemandKb } = measurement
  const level = meterLevel(blocksKb, budgetKb)
  const text = standing(t, level, blocksKb, budgetKb, overByKb)
  const line = t('cost.line', { total: formatKb(blocksKb), budget: formatKb(budgetKb) })
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
        {t('cost.framework', { kb: formatKb(frameworkKb) })}
      </Typography>
      <Typography textColor="neutral700" tag="p" data-testid="cost-on-demand">
        {t('cost.onDemand', { kb: formatKb(onDemandKb) })}
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
                <td>{formatKb(block.kb)}</td>
                <td>{block.onDemandKb > 0 ? formatKb(block.onDemandKb) : '–'}</td>
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
