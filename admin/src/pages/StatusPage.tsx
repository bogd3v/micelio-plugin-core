import {
  Badge,
  Box,
  Button,
  Flex,
  LinkButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  useNotifyAT,
} from '@strapi/design-system'
import { Layouts, Page, useAuth } from '@strapi/strapi/admin'
import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { NavLink } from 'react-router-dom'
import { styled } from 'styled-components'

import type { HostCheckResult } from '../../../server/src/types/host-check'
import type {
  PluginChecksResult,
  StatusFrontend,
  StatusSibling,
  StatusReport,
  StatusSite,
} from '../../../server/src/types/status'
import { hasMessage, useMessages } from '../messages'
import { SITES_READ_PERMISSION, STATUS_READ_PERMISSION } from '../permissions'
import { useHostCheckRun, type HostCheckRun } from '../hooks/useHostCheckRun'
import { useStatus } from '../hooks/useStatus'
import { checkText, type Text } from '../utils/checkText'
import { diagnosticsText } from '../utils/diagnostics'
import { localised } from '../utils/localised'
import { relativeTime } from '../utils/relativeTime'
import { PLUGIN_ID } from '../pluginId'

type Tone = 'success' | 'danger' | 'warning' | 'neutral'

// Token pairs instead of the Badge variants: the `danger` variant's text is 3.9:1 on its
// background, below the 4.5:1 of WCAG AA for its size.
//
// The dot has a colour of its own: it is decorative, the word beside it carries the result, so
// it does not need the 4.5:1 of the text and can be the tone's mid colour, as the artboard draws it.
const TONES: Record<Tone, { backgroundColor: string; textColor: string; dotColor: string }> = {
  success: { backgroundColor: 'success100', textColor: 'success700', dotColor: 'success600' },
  danger: { backgroundColor: 'danger100', textColor: 'danger700', dotColor: 'danger600' },
  // warning700 on warning100 is 4.0:1, below the 4.5:1 of WCAG AA: the text stays dark and the
  // orange is carried by the dot.
  warning: { backgroundColor: 'warning100', textColor: 'neutral800', dotColor: 'warning600' },
  neutral: { backgroundColor: 'neutral150', textColor: 'neutral700', dotColor: 'neutral500' },
}

/** What a host check result shows as: a failed check that is not required is a warning. */
type CheckResult = 'pass' | 'warn' | 'fail' | 'skip'

const CHECK_TONES: Record<CheckResult, Tone> = {
  pass: 'success',
  warn: 'warning',
  fail: 'danger',
  skip: 'neutral',
}

function resultOf(check: HostCheckResult): CheckResult {
  if (check.status === 'fail') return check.required ? 'fail' : 'warn'
  return check.status
}

/** The Micelio page of the admin: what runs, what is reachable and what failed (issue #8). */
export default function StatusPage() {
  const { t } = useMessages()
  return (
    <Page.Protect permissions={[STATUS_READ_PERMISSION]}>
      <Page.Main>
        <Page.Title>{t('status.title')}</Page.Title>
        <StatusContent />
      </Page.Main>
    </Page.Protect>
  )
}

function StatusContent() {
  const { t } = useMessages()
  const { resource, reload, refresh } = useStatus()
  const header = (action?: ReactNode) => (
    <Layouts.Header
      title={t('status.title')}
      subtitle={t('status.subtitle')}
      primaryAction={action}
    />
  )
  if (resource.kind === 'loading') {
    return (
      <>
        {header()}
        <Layouts.Content>
          <Page.Loading>{t('status.loading')}</Page.Loading>
        </Layouts.Content>
      </>
    )
  }
  if (resource.kind === 'error') {
    return (
      <>
        {header()}
        <Layouts.Content>
          <Section title={t('status.error.title')}>
            <Flex direction="column" alignItems="flex-start" gap={2}>
              <Typography textColor="neutral600">{t('status.error')}</Typography>
              <Button variant="secondary" size="S" onClick={reload}>
                {t('status.retry')}
              </Button>
            </Flex>
          </Section>
        </Layouts.Content>
      </>
    )
  }
  return <LoadedStatus report={resource.data} refresh={refresh} header={header} />
}

function LoadedStatus({
  report,
  refresh,
  header,
}: {
  report: StatusReport
  refresh: () => Promise<void>
  header: (action?: ReactNode) => ReactNode
}) {
  const { t } = useMessages()
  const { locale } = useIntl()
  const { notifyStatus, notifyAlert } = useNotifyAT()
  const canReadSites = useAuth('StatusPage', (auth) => auth.permissions).some(
    ({ action, subject }) =>
      action === SITES_READ_PERMISSION.action && subject === SITES_READ_PERMISSION.subject
  )
  // The run lives here, not in the card: its button is in the page header.
  const hostCheck = useHostCheckRun(report.hostCheck)
  const runHostCheck = async () => {
    const answer = await hostCheck.run()
    // The table changes without a focus move: say what the run found.
    // The plugins' checks ran with it: load their results.
    if (answer) await refresh()
    if (answer) {
      notifyStatus(
        `${t(answer.ok ? 'status.hostCheck.ok' : 'status.hostCheck.failed')} ${t(
          'status.hostCheck.checkedAt',
          {
            time: relativeTime(answer.checkedAt, Date.now(), locale),
            environment: answer.environment,
          }
        )}.`
      )
    } else notifyAlert(t('status.hostCheck.runFailed'))
  }
  return (
    <>
      {header(
        <Flex gap={2}>
          <Button variant="tertiary" size="L" loading={hostCheck.isRunning} onClick={runHostCheck}>
            {t(hostCheck.isRunning ? 'status.hostCheck.running' : 'status.hostCheck.run')}
          </Button>
          {canReadSites ? (
            <LinkButton tag={NavLink} size="L" to={`/plugins/${PLUGIN_ID}/sites`}>
              {t('status.manageSites')}
            </LinkButton>
          ) : null}
        </Flex>
      )}
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={6}>
          <StatCards report={report} />
          <HostCheckSection run={hostCheck} />
          <Flex gap={6} alignItems="stretch" wrap="wrap">
            <Box flex="1" minWidth="320px" display="flex">
              <SiblingsSection siblings={report.siblings} />
            </Box>
            <Box flex="1" minWidth="320px" display="flex">
              <ContractsSection report={report} />
            </Box>
          </Flex>
          <PluginChecksSections report={report} />
          <FrontendsSection frontends={report.frontends} />
          <SitesSection sites={report.sites} />
          <DiagnosticsButton report={report} />
        </Flex>
      </Layouts.Content>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box tag="section" background="neutral0" hasRadius shadow="filterShadow" padding={6} flex="1">
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Typography variant="delta" fontWeight="bold" tag="h2">
          {title}
        </Typography>
        {children}
      </Flex>
    </Box>
  )
}

function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const { backgroundColor, textColor } = TONES[tone]
  return (
    <Badge backgroundColor={backgroundColor} textColor={textColor}>
      {children}
    </Badge>
  )
}

/** The dot before a result: decorative, the word beside it carries the result. */
function Dot({ color }: { color: string }) {
  return (
    <Box
      tag="span"
      aria-hidden
      width="0.6rem"
      height="0.6rem"
      background={color}
      style={{ borderRadius: '50%' }}
    />
  )
}

/** A result of a check: a dot and the word in sentence case, on the tone's background. */
function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <Flex
      tag="span"
      display="inline-flex"
      width="fit-content"
      gap={2}
      alignItems="center"
      hasRadius
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      background={TONES[tone].backgroundColor}
    >
      <Dot color={TONES[tone].dotColor} />
      <Typography variant="pi" fontWeight="bold" textColor={TONES[tone].textColor}>
        {children}
      </Typography>
    </Flex>
  )
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

/**
 * The small uppercase label of a stat card and of a host check column: the theme's `sigma` at
 * `fontSizes[1]` and with tracking, as the artboard draws it. The letter-spacing is the one literal
 * value: the theme has no letter-spacing token.
 */
const SmallLabel = styled(Typography)`
  font-size: ${({ theme }) => theme.fontSizes[1]};
  font-weight: ${({ theme }) => theme.fontWeights.bold};
  letter-spacing: 0.08em;
  text-transform: uppercase;
`

/** One of the four cards on top: a label, a figure and a line under it. */
function StatCard({ label, value, note }: { label: string; value: ReactNode; note: ReactNode }) {
  return (
    <Box
      tag="li"
      flex="1"
      minWidth="200px"
      background="neutral0"
      hasRadius
      shadow="filterShadow"
      padding={6}
      // 20px above and below the text: the artboard's cards are 124px high, the theme's 24px make 126.
      paddingTop={5}
      paddingBottom={5}
      style={{ listStyle: 'none' }}
    >
      <Flex tag="dl" direction="column" alignItems="flex-start" gap={1} margin={0}>
        <SmallLabel variant="sigma" textColor="neutral600" tag="dt">
          {label}
        </SmallLabel>
        <Typography fontSize={6} fontWeight="bold" lineHeight={1} tag="dd">
          {value}
        </Typography>
        <Typography variant="omega" textColor="neutral600" tag="dd">
          {note}
        </Typography>
      </Flex>
    </Box>
  )
}

/** The plugin core, the default site's frontend, the sites and the block catalogue, from the report. */
function StatCards({ report }: { report: StatusReport }) {
  const { t } = useMessages()
  const defaultSite = report.sites.find((site) => site.isDefault)
  const frontend = report.frontends.find((candidate) => candidate.origin === defaultSite?.origin)
  const hosts = report.sites.reduce((sum, site) => sum + site.hosts.length, 0)
  return (
    <Flex
      tag="ul"
      aria-label={t('status.cards.label')}
      gap={4}
      wrap="wrap"
      alignItems="stretch"
      margin={0}
      padding={0}
    >
      <StatCard
        label={t('status.card.plugin')}
        value={report.plugin.version}
        note={t('status.card.plugin.line', { line: report.plugin.coreLine })}
      />
      <StatCard
        label={t('status.card.frontend')}
        value={
          frontend ? (frontend.version ?? <span aria-hidden="true">–</span>) : t('status.card.none')
        }
        note={
          frontend ? (
            <Flex tag="span" gap={1} alignItems="center">
              {frontend.version === undefined && frontend.health === 'reachable' ? (
                <span>{`${t('status.card.frontend.noVersion')} · `}</span>
              ) : null}
              <Dot color={frontend.health === 'reachable' ? 'success600' : 'neutral500'} />
              <Typography
                variant="omega"
                textColor={frontend.health === 'reachable' ? 'success700' : 'neutral600'}
              >
                {t(`status.card.frontend.${frontend.health}`)}
              </Typography>
            </Flex>
          ) : (
            t('status.card.frontend.none')
          )
        }
      />
      <StatCard
        label={t('status.card.sites')}
        value={report.sites.length}
        note={t('status.card.sites.note', {
          n: report.sites.filter((site) => site.isDefault).length,
          hosts,
        })}
      />
      <StatCard
        label={t('status.card.blocks')}
        value={report.blocks.count}
        note={t('status.card.blocks.note')}
      />
    </Flex>
  )
}

const REGISTERED = ['adminPages', 'siteSections', 'statusChecks', 'exportSections'] as const

/**
 * The Micelio plugins next to the core, each with its version and what it registered: "registers no
 * extension point" only for a plugin that registered nothing, and a line of its own for one with
 * registrations the role may not see (`hidden`).
 */
function SiblingsSection({ siblings }: { siblings: StatusSibling[] }) {
  const { t } = useMessages()
  return (
    <Section title={t('status.siblings.title')}>
      {siblings.length === 0 ? (
        <Typography textColor="neutral600">{t('status.siblings.none')}</Typography>
      ) : (
        <Flex tag="ul" direction="column" alignItems="stretch" gap={4} margin={0} padding={0}>
          {siblings.map((sibling) => {
            const registered = REGISTERED.filter((kind) => sibling[kind].length > 0)
            return (
              <li key={sibling.name} style={{ listStyle: 'none' }}>
                <Typography fontWeight="bold">{`${sibling.name} ${sibling.version}`}</Typography>
                {registered.length === 0 && !sibling.hidden ? (
                  <Typography tag="p" textColor="neutral600">
                    {t('status.siblings.registersNothing')}
                  </Typography>
                ) : null}
                {registered.length > 0 ? (
                  <Flex tag="dl" direction="column" alignItems="flex-start" gap={1}>
                    {registered.map((kind) => (
                      <Flex key={kind} gap={2} wrap="wrap">
                        <Typography tag="dt" variant="pi" textColor="neutral600">
                          {t(`status.siblings.${kind}`)}
                        </Typography>
                        <Typography tag="dd" variant="pi">
                          {sibling[kind].join(', ')}
                        </Typography>
                      </Flex>
                    ))}
                  </Flex>
                ) : null}
                {sibling.hidden ? (
                  <Typography tag="p" textColor="neutral600">
                    {t('status.siblings.hidden')}
                  </Typography>
                ) : null}
              </li>
            )
          })}
        </Flex>
      )}
    </Section>
  )
}

/** What this core promises plugins, frontends and themes: the contracts of the standard, section 6. */
function ContractsSection({ report }: { report: StatusReport }) {
  const { t } = useMessages()
  const { contracts } = report
  return (
    <Section title={t('status.contracts.title')}>
      <Flex tag="dl" direction="column" alignItems="stretch" gap={3}>
        <Fact label={t('status.blocks.count')} value={contracts.blocks} />
        <Fact
          label={t('status.contracts.editorialStates')}
          value={contracts.editorialStates
            .map((state) =>
              hasMessage(`builder.state.${state}`) ? t(`builder.state.${state}`) : state
            )
            .join(', ')}
        />
        <Fact label={t('status.contracts.hooks')} value={contracts.hooks.join(', ')} />
        <Fact
          label={t('status.contracts.extensionPoints')}
          value={contracts.extensionPoints.join(', ')}
        />
      </Flex>
    </Section>
  )
}

/** An outline triangle with an exclamation mark, as the artboard's banner shows. */
const WarningMark = () => (
  <svg
    width="1.6rem"
    height="1.6rem"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    style={{ flexShrink: 0 }}
  >
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
)

/**
 * The table of a card: the card is its frame, so the table's own shadow and corners are taken off.
 * The Design System insets a table's rows by 24px; the table takes them back (`marginInline` in
 * `HostCheckSection`), so the rules run to the card's edges, and the first and last cell keep the
 * 24px: the first column starts where the card's title does and the last ends where the badge
 * above it does, with its words on the right.
 */
const FlatTable = styled.div`
  & > div {
    box-shadow: none;
    border: 0;
    border-radius: 0;
  }
  && td {
    white-space: normal;
  }
  thead {
    background: ${({ theme }) => theme.colors.neutral100};
  }
  && th {
    height: ${({ theme }) => theme.spaces[8]};
    padding-top: 0;
    padding-bottom: 0;
  }
  && th:first-of-type,
  && td:first-of-type {
    padding-left: ${({ theme }) => theme.spaces[6]};
  }
  && th:last-of-type,
  && td:last-of-type {
    padding-right: ${({ theme }) => theme.spaces[6]};
  }
`

function HostCheckSection({ run }: { run: HostCheckRun }) {
  const { t, rich, date } = useMessages()
  const { locale } = useIntl()
  const { report, hasFailed } = run
  const say = (text: Text) => ('messageId' in text ? t(text.messageId) : text.text)
  const results = report ? report.results.map((check) => ({ check, result: resultOf(check) })) : []
  const warnings = results.filter(({ result }) => result === 'warn')
  const failures = results.filter(({ result }) => result === 'fail')
  const flagged = results.filter(({ result }) => result === 'warn' || result === 'fail')
  const counts = [
    failures.length > 0 ? t('status.hostCheck.badge.failures', { count: failures.length }) : null,
    warnings.length > 0 ? t('status.hostCheck.badge.warnings', { count: warnings.length }) : null,
  ].filter(Boolean)

  const header = (
    <Flex gap={4} wrap="wrap" justifyContent="space-between" alignItems="flex-start">
      <Flex direction="column" alignItems="flex-start" gap={1}>
        <Typography variant="delta" fontWeight="bold" tag="h2">
          {t('status.hostCheck.title')}
        </Typography>
        <Typography textColor="neutral600" variant="pi">
          {report
            ? rich('status.hostCheck.checkedAt', {
                time: (
                  <time dateTime={report.checkedAt} title={date(report.checkedAt)}>
                    {relativeTime(report.checkedAt, Date.now(), locale)}
                  </time>
                ),
                environment: report.environment,
              })
            : t('status.hostCheck.notRun')}
          {' · '}
          {t('status.hostCheck.alsoAs')}{' '}
          <Box
            tag="code"
            background="neutral150"
            hasRadius
            paddingLeft={1}
            paddingRight={1}
            style={{ fontFamily: 'monospace' }}
          >
            npx micelio doctor
          </Box>
        </Typography>
      </Flex>
      {counts.length > 0 ? (
        <Pill tone={failures.length > 0 ? 'danger' : 'warning'}>{counts.join(' · ')}</Pill>
      ) : null}
    </Flex>
  )
  const failure = hasFailed ? (
    <Typography textColor="danger700">{t('status.hostCheck.runFailed')}</Typography>
  ) : null

  return (
    <Box
      tag="section"
      background="neutral0"
      hasRadius
      shadow="filterShadow"
      style={{ overflow: 'hidden' }}
    >
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Box padding={6} paddingBottom={0}>
          <Flex direction="column" alignItems="stretch" gap={4}>
            {header}
            {failure}
          </Flex>
        </Box>
        {report ? (
          <FlatTable>
            <Table
              colCount={3}
              rowCount={results.length + 1}
              style={{ width: 'calc(100% + 48px)', marginInline: '-24px' }}
            >
              <Thead>
                <Tr>
                  <Th>
                    <SmallLabel variant="sigma">{t('status.hostCheck.column.check')}</SmallLabel>
                  </Th>
                  <Th>
                    <SmallLabel variant="sigma">{t('status.hostCheck.column.found')}</SmallLabel>
                  </Th>
                  <Th>
                    <Flex justifyContent="flex-end" width="100%">
                      <SmallLabel variant="sigma">{t('status.hostCheck.column.status')}</SmallLabel>
                    </Flex>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {results.map(({ check, result }) => {
                  const title = checkText(check, 'title', hasMessage)
                  return (
                    <Tr key={check.id}>
                      <Td>
                        <Flex direction="column" alignItems="flex-start" gap={1}>
                          <Typography fontWeight="regular">
                            {title ? say(title) : check.id}
                          </Typography>
                          <Typography variant="pi" textColor="neutral600">
                            {t(
                              check.required
                                ? 'status.hostCheck.required'
                                : 'status.hostCheck.optional'
                            )}
                          </Typography>
                        </Flex>
                      </Td>
                      <Td>
                        <Typography textColor="neutral800">{check.detail}</Typography>
                      </Td>
                      <Td>
                        <Flex justifyContent="flex-end">
                          <Pill tone={CHECK_TONES[result]}>
                            {t(`status.hostCheck.status.${result}`)}
                          </Pill>
                        </Flex>
                      </Td>
                    </Tr>
                  )
                })}
              </Tbody>
            </Table>
          </FlatTable>
        ) : null}
        {flagged.map(({ check, result }) => {
          const title = checkText(check, 'title', hasMessage)
          const fix = checkText(check, 'fix', hasMessage)
          return (
            <Flex
              key={check.id}
              tag="div"
              role="note"
              gap={3}
              alignItems="flex-start"
              padding={4}
              paddingLeft={6}
              paddingRight={6}
              background={TONES[CHECK_TONES[result]].backgroundColor}
            >
              <Box color="neutral800">
                <WarningMark />
              </Box>
              <Typography textColor="neutral800">
                <strong>{`${title ? say(title) : check.id}.`}</strong> {fix ? say(fix) : ''}
              </Typography>
            </Flex>
          )
        })}
      </Flex>
    </Box>
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
