import { Badge, Box, Button, Flex, Link, Typography, useNotifyAT } from '@strapi/design-system'
import { Layouts, Page, useAuth } from '@strapi/strapi/admin'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import styled from 'styled-components'

import type { AboutReport } from '../../../server/src/types/about'
import { MicelioIcon } from '../components/MicelioIcon'
import { useLoaded, type Loaded } from '../hooks/useAsync'
import { useMessages } from '../messages'
import { STATUS_READ_PERMISSION } from '../permissions'
import { PLUGIN_ID } from '../pluginId'
import { useFetchClient } from '@strapi/strapi/admin'

const REPOSITORY = 'https://github.com/bogd3v/micelio-plugin-core'
const LINKS = [
  { id: 'docs', href: `${REPOSITORY}/tree/main/docs` },
  { id: 'themes', href: 'https://github.com/bogd3v/micelio-themes' },
  { id: 'issues', href: `${REPOSITORY}/issues` },
  { id: 'security', href: 'https://github.com/bogd3v/.github/blob/main/SECURITY.md' },
  { id: 'releases', href: `${REPOSITORY}/releases` },
] as const
/** A row of a list or a description list: a rule (the header rule's colour) rules it off from the one before. */
const RuledRow = styled.div`
  padding: ${({ theme }) => `${theme.spaces[2]} 0`};
  & + & {
    border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
  }
`
const VersionRow = styled(RuledRow)`
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 2fr;
  gap: ${({ theme }) => theme.spaces[3]};
`
/** A row of Where to go: ruled off from the header rule above it as well (the artboard `About`). */
const LinkRow = styled(RuledRow)`
  border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
`
const TILES = ['editor', 'site', 'themes'] as const

// Two cards side by side while each has room for 36rem, stacked under that (the artboard `About`).
const COLUMNS = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(36rem, 100%), 1fr))',
  gap: 24,
  alignItems: 'start',
} as const

/**
 * A card of the page: its title, a rule under it unless `ruled` is false, and the content. The title is
 * semibold (the design system's `bold`, 600), as on the artboard.
 */
function Panel({
  title,
  children,
  ruled = true,
  tight = false,
}: {
  title: string
  children: ReactNode
  ruled?: boolean
  /** The rows start close under the header rule (Versions and Where to go), as on the artboard. */
  tight?: boolean
}) {
  return (
    <Box tag="section" background="neutral0" hasRadius shadow="filterShadow">
      <Box
        paddingTop={ruled ? 4 : 5}
        paddingBottom={ruled ? 4 : 0}
        paddingLeft={6}
        paddingRight={6}
        borderColor="neutral150"
        borderStyle="solid"
        borderWidth={ruled ? '0 0 1px 0' : '0'}
      >
        <Typography variant="delta" fontWeight="bold" tag="h2">
          {title}
        </Typography>
      </Box>
      <Flex
        direction="column"
        alignItems="stretch"
        gap={4}
        padding={6}
        paddingTop={tight ? 1 : ruled ? 4 : 0}
      >
        {children}
      </Flex>
    </Box>
  )
}

// The text of a card's paragraph stops at about two thirds of the card, as on the artboard.
const BODY_WIDTH = '78ch'

/** The licence identifier the Licence and credits text sets in bold; it reads the same in every language. */
const LICENCE_ID = 'AGPL-3.0-only'

/** `text` with each occurrence of `word` in bold. */
function withBold(text: string, word: string): ReactNode {
  return text
    .split(word)
    .flatMap((part, index) => (index === 0 ? [part] : [<strong key={index}>{word}</strong>, part]))
}

/** About Micelio: what the plugin is, what runs here and what to paste into a support request. */
export default function AboutPage() {
  const { t } = useMessages()
  const { resource, reload } = useLoaded<AboutReport>('/micelio/about')
  const [report, setReport] = useState<AboutReport | null>(null)
  const current = report ?? (resource.kind === 'ready' ? resource.data : null)
  return (
    <Page.Main>
      <Page.Title>{t('about.title')}</Page.Title>
      {/* Not `Layouts.Header`: its subtitle sits under the mark too; here it starts under the title's text. */}
      <Box
        background="neutral100"
        paddingTop={8}
        paddingBottom={4}
        paddingLeft={10}
        paddingRight={10}
      >
        <Flex justifyContent="space-between" alignItems="flex-start" gap={4} wrap="wrap">
          <Flex gap={3} alignItems="flex-start">
            <Box tag="span" color="primary600" display="flex" paddingTop={1}>
              <MicelioIcon width="4rem" height="4rem" />
            </Box>
            <Flex direction="column" alignItems="flex-start" gap={1}>
              <Typography variant="alpha" tag="h1">
                {t('about.title')}
              </Typography>
              <Typography variant="epsilon" textColor="neutral600" tag="p">
                {t('about.subtitle')}
              </Typography>
            </Flex>
          </Flex>
          {current ? <CopyButton text={current.diagnostics} /> : null}
        </Flex>
      </Box>
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={6}>
          <Panel title={t('about.what.title')} ruled={false}>
            <Typography tag="p" style={{ maxWidth: BODY_WIDTH }}>
              {t('about.body')}
            </Typography>
            <Flex gap={4} wrap="wrap" alignItems="stretch" marginTop={3}>
              {TILES.map((tile) => (
                <Box
                  key={tile}
                  flex="1"
                  minWidth="220px"
                  background="neutral100"
                  hasRadius
                  padding={4}
                >
                  <Typography variant="pi" fontWeight="bold" tag="h3">
                    {t(`about.tile.${tile}.title`)}
                  </Typography>
                  <Typography tag="p" variant="pi" textColor="neutral600" style={{ marginTop: 6 }}>
                    {t(`about.tile.${tile}`)}
                  </Typography>
                </Box>
              ))}
            </Flex>
          </Panel>
          <Checks
            resource={resource}
            report={current}
            onReport={setReport}
            reload={reload}
            more={
              <>
                <Panel title={t('about.links.title')} tight>
                  <Flex
                    tag="ul"
                    direction="column"
                    alignItems="stretch"
                    gap={0}
                    margin={0}
                    padding={0}
                  >
                    {LINKS.map(({ id, href }) => (
                      <LinkRow as="li" key={id} style={{ listStyle: 'none' }}>
                        <Link href={href} isExternal>
                          <Typography fontWeight="bold" textColor="primary600">
                            {t(`about.link.${id}`)}
                          </Typography>
                        </Link>
                        <Typography tag="p" variant="pi" textColor="neutral600">
                          {t(`about.link.${id}.hint`)}
                        </Typography>
                      </LinkRow>
                    ))}
                  </Flex>
                </Panel>
                <Panel title={t('about.licence.title')}>
                  <Typography tag="p">{withBold(t('about.licence.free'), LICENCE_ID)}</Typography>
                  <Typography tag="p">{t('about.licence.strapi')}</Typography>
                  <Typography tag="p">{t('about.licence.trademark')}</Typography>
                </Panel>
              </>
            }
          />
        </Flex>
      </Layouts.Content>
    </Page.Main>
  )
}

function Checks(props: {
  resource: Loaded<AboutReport>
  report: AboutReport | null
  onReport: (report: AboutReport) => void
  reload: () => void
  /** The cards after Versions and Diagnostics: they sit in a second row of two columns. */
  more: ReactNode
}) {
  const { t } = useMessages()
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const permissions = useAuth('AboutPage', (state) => state.permissions)
  const canReadStatus = permissions.some(({ action }) => action === STATUS_READ_PERMISSION.action)
  const [isRunning, setIsRunning] = useState(false)
  const [hasFailed, setHasFailed] = useState(false)
  const { onReport } = props
  const run = useCallback(async () => {
    setIsRunning(true)
    setHasFailed(false)
    try {
      const response = await clientRef.current.post<{ data: AboutReport }>('/micelio/about/refresh')
      onReport(response.data.data)
    } catch {
      setHasFailed(true)
    } finally {
      setIsRunning(false)
    }
  }, [onReport])

  if (props.resource.kind === 'loading') {
    return (
      <>
        <Page.Loading>{t('about.loading')}</Page.Loading>
        <div style={COLUMNS}>{props.more}</div>
      </>
    )
  }
  if (!props.report) {
    return (
      <>
        <Panel title={t('about.versions.title')}>
          <Typography textColor="neutral600">{t('about.error')}</Typography>
          <Flex>
            <Button variant="secondary" size="S" onClick={props.reload}>
              {t('status.retry')}
            </Button>
          </Flex>
        </Panel>
        <div style={COLUMNS}>{props.more}</div>
      </>
    )
  }
  const report = props.report
  return (
    <>
      <div style={COLUMNS}>
        <Panel title={t('about.versions.title')} tight>
          <dl style={{ margin: 0 }}>
            <Row
              label={t('about.row.plugin')}
              value={`@micelio/strapi-plugin-core ${report.plugin.version}`}
              mono
            />
            <Row label={t('about.row.line')} value={report.plugin.coreLine} />
            <Row
              label={t('about.row.strapi')}
              value={t('about.row.strapi.value', {
                strapi: report.strapi.version,
                node: report.strapi.node,
                database: report.database,
              })}
            />
            <Row
              label={t('about.row.frontend')}
              value={
                report.frontends.length === 0 ? (
                  t('about.row.frontend.none')
                ) : (
                  <Flex direction="column" alignItems="flex-end" gap={1}>
                    {report.frontends.map((frontend) => (
                      <Flex
                        key={frontend.origin}
                        gap={2}
                        alignItems="center"
                        justifyContent="flex-end"
                        wrap="wrap"
                      >
                        <Typography>
                          {frontend.version ? `Micelio ${frontend.version} · ` : ''}
                          {frontend.origin}
                        </Typography>
                        <Badge
                          backgroundColor={
                            frontend.health === 'reachable' ? 'success100' : 'neutral150'
                          }
                          textColor={frontend.health === 'reachable' ? 'success700' : 'neutral700'}
                        >
                          {t(`about.health.${frontend.health}`)}
                        </Badge>
                      </Flex>
                    ))}
                  </Flex>
                )
              }
            />
            {report.siblings.map((sibling) => (
              <Row
                key={sibling.name}
                label={t('about.row.sibling')}
                value={`${sibling.name} ${sibling.version}`}
                mono
              />
            ))}
            <Row
              label={t('about.row.theme')}
              value={
                report.theme === null
                  ? t('about.row.theme.none')
                  : report.theme.themeVersion
                    ? t('about.row.theme.value', {
                        theme: report.theme.themeId,
                        version: report.theme.themeVersion,
                      })
                    : t('about.row.theme.noVersion', { theme: report.theme.themeId })
              }
            />
            <Row label={t('about.row.update')} value={<UpdateText report={report} />} />
          </dl>
          <Typography variant="pi" textColor="neutral600">
            {t('about.versions.note')}
          </Typography>
        </Panel>
        <Panel title={t('about.diagnostics.title')}>
          {/* neutral800 and neutral0 swap with the theme, so the text keeps its contrast in both. */}
          <Box
            tag="pre"
            background="neutral800"
            color="neutral0"
            hasRadius
            padding={4}
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              overflowX: 'auto',
              fontSize: '1.3rem',
              lineHeight: 1.6,
            }}
          >
            <code>{report.diagnostics}</code>
          </Box>
          <Typography variant="pi" textColor="neutral600">
            {t('about.diagnostics.note')}
          </Typography>
          <Flex gap={3} alignItems="center" wrap="wrap">
            <Button variant="tertiary" size="S" loading={isRunning} onClick={run}>
              {t('about.diagnostics.run')}
            </Button>
            {canReadStatus ? (
              <Link tag={NavLink} to={`/plugins/${PLUGIN_ID}`}>
                {t('about.diagnostics.status')}
              </Link>
            ) : null}
            {hasFailed ? (
              <Typography role="alert" textColor="danger700">
                {t('about.diagnostics.runFailed')}
              </Typography>
            ) : null}
          </Flex>
        </Panel>
      </div>
      <div style={COLUMNS}>{props.more}</div>
    </>
  )
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <VersionRow>
      <Typography tag="dt" textColor="neutral600">
        {label}
      </Typography>
      <Typography
        tag="dd"
        style={{ margin: 0, textAlign: 'right', ...(mono ? { fontFamily: 'monospace' } : {}) }}
      >
        {value}
      </Typography>
    </VersionRow>
  )
}

function UpdateText({ report }: { report: AboutReport }) {
  const { t } = useMessages()
  const { update } = report
  if (update.state === 'available') {
    // The orange is a dot: `warning700` is 4.42:1 on `neutral0`, so the text keeps the default colour.
    return (
      <>
        <Box
          tag="span"
          aria-hidden="true"
          data-testid="update-dot"
          background="warning600"
          marginRight={2}
          style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%' }}
        />
        {t('about.update.available', { version: update.version })}{' '}
        {update.url ? (
          <Link href={update.url} isExternal>
            {t('about.update.notes')}
          </Link>
        ) : null}
      </>
    )
  }
  return <>{t(`about.update.${update.state}`)}</>
}

function CopyButton({ text }: { text: string }) {
  const { t } = useMessages()
  const { notifyStatus, notifyAlert } = useNotifyAT()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      notifyStatus(t('about.copy.done'))
    } catch {
      // Clipboard access can be refused (an insecure origin, a browser setting): say so.
      notifyAlert(t('about.copy.failed'))
    }
  }
  return (
    <Button variant="tertiary" size="L" startIcon={<CopyMark />} onClick={copy}>
      {t('about.copy')}
    </Button>
  )
}

/** Two overlapping sheets, the copy icon of the artboard (drawn here: `@strapi/icons` is not loadable in Node). */
const CopyMark = () => (
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
  >
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </svg>
)
