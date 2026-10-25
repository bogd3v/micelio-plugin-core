import {
  Badge,
  Box,
  Button,
  Flex,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  useNotifyAT,
} from '@strapi/design-system'
import { Layouts, Page } from '@strapi/strapi/admin'
import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'

import type { HostCheckReport, HostCheckStatus } from '../../../server/src/types/host-check'
import type {
  PluginChecksResult,
  StatusFrontend,
  StatusReport,
  StatusSite,
} from '../../../server/src/types/status'
import { hasMessage, useMessages } from '../messages'
import { STATUS_READ_PERMISSION } from '../permissions'
import { useHostCheckRun } from '../hooks/useHostCheckRun'
import { useStatus } from '../hooks/useStatus'
import { checkText, type Text } from '../utils/checkText'
import { diagnosticsText } from '../utils/diagnostics'
import { localised } from '../utils/localised'

type Tone = 'success' | 'danger' | 'warning' | 'neutral'

// Token pairs instead of the Badge variants: the `danger` variant's text is 3.9:1 on its
// background, below the 4.5:1 of WCAG AA for its size.
const TONES: Record<Tone, { backgroundColor: string; textColor: string }> = {
  success: { backgroundColor: 'success100', textColor: 'success700' },
  danger: { backgroundColor: 'danger100', textColor: 'danger700' },
  // warning700 on warning100 is 4.0:1, below the 4.5:1 of WCAG AA.
  warning: { backgroundColor: 'warning100', textColor: 'neutral800' },
  neutral: { backgroundColor: 'neutral150', textColor: 'neutral700' },
}

const CHECK_TONES: Record<HostCheckStatus, Tone> = {
  pass: 'success',
  fail: 'danger',
  skip: 'neutral',
}

/** The Micelio page of the admin: what runs, what is reachable and what failed (issue #8). */
export default function StatusPage() {
  const { t } = useMessages()
  return (
    <Page.Protect permissions={[STATUS_READ_PERMISSION]}>
      <Page.Main>
        <Page.Title>{t('status.title')}</Page.Title>
        <Layouts.Header title={t('status.title')} subtitle={t('status.subtitle')} />
        <Layouts.Content>
          <StatusContent />
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  )
}

function StatusContent() {
  const { t } = useMessages()
  const { resource, reload, refresh } = useStatus()
  if (resource.kind === 'loading') return <Page.Loading>{t('status.loading')}</Page.Loading>
  if (resource.kind === 'error') {
    return (
      <Section title={t('status.error.title')}>
        <Flex direction="column" alignItems="flex-start" gap={2}>
          <Typography textColor="neutral600">{t('status.error')}</Typography>
          <Button variant="secondary" size="S" onClick={reload}>
            {t('status.retry')}
          </Button>
        </Flex>
      </Section>
    )
  }
  const report: StatusReport = resource.data
  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <PluginSection report={report} />
      <HostCheckSection initial={report.hostCheck} onRan={refresh} />
      <PluginChecksSections report={report} />
      <FrontendsSection frontends={report.frontends} />
      <SitesSection sites={report.sites} />
      <DiagnosticsButton report={report} />
    </Flex>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box tag="section" background="neutral0" hasRadius shadow="filterShadow" padding={6}>
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Typography variant="delta" tag="h2">
          {title}
        </Typography>
        {children}
      </Flex>
    </Box>
  )
}

function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <Badge {...TONES[tone]}>{children}</Badge>
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <Flex direction="column" alignItems="flex-start" gap={1}>
      <Typography variant="sigma" textColor="neutral600" tag="dt">
        {label}
      </Typography>
      <Typography tag="dd">{value}</Typography>
    </Flex>
  )
}

function PluginSection({ report }: { report: StatusReport }) {
  const { t } = useMessages()
  return (
    <Section title={t('status.plugin.title')}>
      <Flex tag="dl" gap={8} wrap="wrap" alignItems="flex-start">
        <Fact label={t('status.plugin.version')} value={report.plugin.version} />
        <Fact label={t('status.plugin.coreLine')} value={report.plugin.coreLine} />
        <Fact label={t('status.blocks.count')} value={report.blocks.count} />
        <Fact label={t('status.sites.count')} value={report.sites.length} />
      </Flex>
    </Section>
  )
}

function HostCheckSection({
  initial,
  onRan,
}: {
  initial: HostCheckReport | null
  onRan: () => Promise<void>
}) {
  const { t, date } = useMessages()
  const { notifyStatus, notifyAlert } = useNotifyAT()
  const { report, isRunning, hasFailed, run } = useHostCheckRun(initial)
  const say = (text: Text) => ('messageId' in text ? t(text.messageId) : text.text)
  const verdict = (current: HostCheckReport) =>
    `${t(current.ok ? 'status.hostCheck.ok' : 'status.hostCheck.failed')} ${t(
      'status.hostCheck.checkedAt',
      { date: date(current.checkedAt), environment: current.environment }
    )}`

  const runAgain = async () => {
    const answer = await run()
    // The table changes without a focus move: say what the run found.
    // The plugins' checks ran with it: load their results.
    if (answer) await onRan()
    if (answer) notifyStatus(verdict(answer))
    else notifyAlert(t('status.hostCheck.runFailed'))
  }

  const header = (
    <Flex gap={4} wrap="wrap" justifyContent="space-between" alignItems="center">
      <Typography textColor={report ? undefined : 'neutral600'}>
        {report ? verdict(report) : t('status.hostCheck.notRun')}
      </Typography>
      <Button variant="secondary" size="S" loading={isRunning} onClick={runAgain}>
        {t(isRunning ? 'status.hostCheck.running' : 'status.hostCheck.runAgain')}
      </Button>
    </Flex>
  )
  const failure = hasFailed ? (
    <Typography textColor="danger700">{t('status.hostCheck.runFailed')}</Typography>
  ) : null

  if (!report) {
    return (
      <Section title={t('status.hostCheck.title')}>
        {header}
        {failure}
      </Section>
    )
  }
  return (
    <Section title={t('status.hostCheck.title')}>
      {header}
      {failure}
      <Table colCount={3} rowCount={report.results.length + 1}>
        <Thead>
          <Tr>
            <Th>
              <Typography variant="sigma">{t('status.hostCheck.column.check')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('status.hostCheck.column.status')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('status.hostCheck.column.found')}</Typography>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {report.results.map((result) => {
            const title = checkText(result, 'title', hasMessage)
            const fix = result.status === 'fail' ? checkText(result, 'fix', hasMessage) : null
            return (
              <Tr key={result.id}>
                <Td>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    <Typography fontWeight="bold">{title ? say(title) : result.id}</Typography>
                    <Typography variant="pi" textColor="neutral600">
                      {t(
                        result.required ? 'status.hostCheck.required' : 'status.hostCheck.optional'
                      )}
                    </Typography>
                  </Flex>
                </Td>
                <Td>
                  <StatusBadge tone={CHECK_TONES[result.status]}>
                    {t(`status.hostCheck.status.${result.status}`)}
                  </StatusBadge>
                </Td>
                <Td>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    <Typography textColor="neutral800">{result.detail}</Typography>
                    {fix ? (
                      <Typography variant="pi" textColor="neutral800">
                        <strong>{t('status.hostCheck.fix')}:</strong> {say(fix)}
                      </Typography>
                    ) : null}
                  </Flex>
                </Td>
              </Tr>
            )
          })}
        </Tbody>
      </Table>
      <Typography variant="pi" textColor="neutral600">
        {t('status.hostCheck.rerun')}
      </Typography>
    </Section>
  )
}

function FrontendsSection({ frontends }: { frontends: StatusFrontend[] }) {
  const { t } = useMessages()
  if (frontends.length === 0) {
    return (
      <Section title={t('status.frontends.title')}>
        <Typography textColor="neutral600">{t('status.frontends.none')}</Typography>
      </Section>
    )
  }
  return (
    <Section title={t('status.frontends.title')}>
      <Table colCount={4} rowCount={frontends.length + 1}>
        <Thead>
          <Tr>
            <Th>
              <Typography variant="sigma">{t('status.frontends.column.origin')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('status.frontends.column.sites')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('status.frontends.column.health')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('status.frontends.column.version')}</Typography>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {frontends.map((frontend) => (
            <Tr key={frontend.origin}>
              <Td>
                <Typography>{frontend.origin}</Typography>
              </Td>
              <Td>
                <Typography>{frontend.sites.join(', ')}</Typography>
              </Td>
              <Td>
                <Flex direction="column" alignItems="flex-start" gap={1}>
                  <StatusBadge tone={frontend.health === 'reachable' ? 'success' : 'neutral'}>
                    {t(`status.frontends.health.${frontend.health}`)}
                  </StatusBadge>
                  {frontend.health === 'unavailable' ? (
                    <Typography variant="pi" textColor="neutral600">
                      {t('status.frontends.unavailable')}
                    </Typography>
                  ) : null}
                </Flex>
              </Td>
              <Td>
                <Typography>{frontend.version ?? t('status.frontends.noVersion')}</Typography>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Section>
  )
}

function SitesSection({ sites }: { sites: StatusSite[] }) {
  const { t } = useMessages()
  return (
    <Section title={t('status.sites.title')}>
      <Table colCount={4} rowCount={sites.length + 1}>
        <Thead>
          <Tr>
            <Th>
              <Typography variant="sigma">{t('status.sites.column.name')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('status.sites.column.slug')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('status.sites.column.hosts')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('status.sites.column.url')}</Typography>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {sites.map((site) => (
            <Tr key={site.documentId}>
              <Td>
                <Flex gap={2}>
                  <Typography>{site.name}</Typography>
                  {site.isDefault ? <Badge>{t('status.sites.default')}</Badge> : null}
                </Flex>
              </Td>
              <Td>
                <Typography>{site.slug}</Typography>
              </Td>
              <Td>
                <Typography>
                  {site.hosts.length > 0 ? site.hosts.join(', ') : t('status.sites.noHosts')}
                </Typography>
              </Td>
              <Td>
                <Typography>{site.origin ?? t('status.sites.noUrl')}</Typography>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Section>
  )
}

const PLUGIN_TONES: Record<'ok' | 'warn' | 'fail', Tone> = {
  ok: 'success',
  warn: 'warning',
  fail: 'danger',
}

/** One card per sibling plugin that registered status checks (`registerStatusChecks`). */
function PluginChecksSections({ report }: { report: StatusReport }) {
  return (
    <>
      {Object.entries(report.plugins).map(([id, result]) => (
        <PluginChecksCard key={id} result={result} sites={report.sites} />
      ))}
    </>
  )
}

function PluginChecksCard({ result, sites }: { result: PluginChecksResult; sites: StatusSite[] }) {
  const { t, date } = useMessages()
  const { locale } = useIntl()
  const slugOf = (documentId: string) =>
    sites.find((site) => site.documentId === documentId)?.slug ?? documentId
  return (
    <Section title={localised(result.label, locale)}>
      <Typography textColor="neutral600">
        {result.ranAt === null
          ? t('status.plugins.notRun')
          : t('status.plugins.ranAt', { date: date(result.ranAt) })}
      </Typography>
      {result.ranAt !== null && result.checks.length === 0 ? (
        <Typography textColor="neutral600">{t('status.plugins.empty')}</Typography>
      ) : null}
      {result.checks.length > 0 ? (
        <Table colCount={4} rowCount={result.checks.length + 1}>
          <Thead>
            <Tr>
              <Th>
                <Typography variant="sigma">{t('status.plugins.column.site')}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">{t('status.plugins.column.check')}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">{t('status.plugins.column.status')}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">{t('status.plugins.column.found')}</Typography>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {result.checks.map((check) => (
              <Tr key={`${check.site}:${check.id}`}>
                <Td>
                  <Typography>{slugOf(check.site)}</Typography>
                </Td>
                <Td>
                  <Typography fontWeight="bold">{localised(check.title, locale)}</Typography>
                </Td>
                <Td>
                  <StatusBadge tone={PLUGIN_TONES[check.status]}>
                    {t(`status.plugins.status.${check.status}`)}
                  </StatusBadge>
                </Td>
                <Td>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    {check.detail ? (
                      <Typography textColor="neutral800">
                        {localised(check.detail, locale)}
                      </Typography>
                    ) : null}
                    {check.fix ? (
                      <Typography variant="pi" textColor="neutral800">
                        <strong>{t('status.plugins.fix')}:</strong> {localised(check.fix, locale)}
                      </Typography>
                    ) : null}
                  </Flex>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      ) : null}
    </Section>
  )
}

/** Copies the diagnostics of the page for a support request. */
function DiagnosticsButton({ report }: { report: StatusReport }) {
  const { t } = useMessages()
  const { notifyStatus, notifyAlert } = useNotifyAT()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diagnosticsText(report))
      notifyStatus(t('status.diagnostics.copied'))
    } catch {
      // Clipboard access can be refused (an insecure origin, a browser setting): say so.
      notifyAlert(t('status.diagnostics.failed'))
    }
  }
  return (
    <Flex>
      <Button variant="tertiary" size="S" onClick={copy}>
        {t('status.diagnostics.copy')}
      </Button>
    </Flex>
  )
}
