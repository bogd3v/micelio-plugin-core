import { Badge, Box, Button, Flex, Link, Typography, useNotifyAT } from '@strapi/design-system'
import { Layouts, Page, useAuth } from '@strapi/strapi/admin'
import { useCallback, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'

import type { AboutReport } from '../../../server/src/types/about'
import { Panel } from '../components/Panel'
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
const TILES = ['editor', 'site', 'themes'] as const

/** About Micelio: what the plugin is, what runs here and what to paste into a support request. */
export default function AboutPage() {
  const { t } = useMessages()
  const { resource, reload } = useLoaded<AboutReport>('/micelio/about')
  const [report, setReport] = useState<AboutReport | null>(null)
  const current = report ?? (resource.kind === 'ready' ? resource.data : null)
  return (
    <Page.Main>
      <Page.Title>{t('about.title')}</Page.Title>
      <Layouts.Header
        title={t('about.title')}
        subtitle={t('about.subtitle')}
        primaryAction={current ? <CopyButton text={current.diagnostics} /> : undefined}
      />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={6}>
          <Panel title={t('about.what.title')}>
            <Typography>{t('about.body')}</Typography>
            <Flex gap={4} wrap="wrap" alignItems="stretch">
              {TILES.map((tile) => (
                <Box
                  key={tile}
                  flex="1"
                  minWidth="220px"
                  background="neutral100"
                  hasRadius
                  padding={4}
                >
                  <Typography variant="delta" tag="h3">
                    {t(`about.tile.${tile}.title`)}
                  </Typography>
                  <Typography tag="p" textColor="neutral600">
                    {t(`about.tile.${tile}`)}
                  </Typography>
                </Box>
              ))}
            </Flex>
          </Panel>
          <Checks resource={resource} report={current} onReport={setReport} reload={reload} />
          <Panel title={t('about.links.title')}>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {LINKS.map(({ id, href }) => (
                <li key={id}>
                  <Link href={href} isExternal>
                    {t(`about.link.${id}`)}
                  </Link>{' '}
                  <Typography tag="span" variant="pi" textColor="neutral600">
                    {t(`about.link.${id}.hint`)}
                  </Typography>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title={t('about.licence.title')}>
            <Typography tag="p">{t('about.licence.free')}</Typography>
            <Typography tag="p">{t('about.licence.strapi')}</Typography>
            <Typography tag="p">{t('about.licence.trademark')}</Typography>
          </Panel>
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

  if (props.resource.kind === 'loading') return <Page.Loading>{t('about.loading')}</Page.Loading>
  if (!props.report) {
    return (
      <Panel title={t('about.versions.title')}>
        <Typography textColor="neutral600">{t('about.error')}</Typography>
        <Flex>
          <Button variant="secondary" size="S" onClick={props.reload}>
            {t('status.retry')}
          </Button>
        </Flex>
      </Panel>
    )
  }
  const report = props.report
  return (
    <>
      <Panel title={t('about.versions.title')}>
        <dl
          style={{
            margin: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(180px, 1fr) 3fr',
            gap: 12,
          }}
        >
          <Row
            label={t('about.row.plugin')}
            value={`@micelio/strapi-plugin-core ${report.plugin.version}`}
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
                <Flex direction="column" alignItems="flex-start" gap={1}>
                  {report.frontends.map((frontend) => (
                    <Flex key={frontend.origin} gap={2} alignItems="center" wrap="wrap">
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
            />
          ))}
          <Row label={t('about.row.update')} value={<UpdateText report={report} />} />
        </dl>
        <Typography variant="pi" textColor="neutral600">
          {t('about.versions.note')}
        </Typography>
      </Panel>
      <Panel title={t('about.diagnostics.title')}>
        <Box
          tag="pre"
          background="neutral100"
          hasRadius
          padding={4}
          style={{ margin: 0, whiteSpace: 'pre-wrap', overflowX: 'auto' }}
        >
          <code>{report.diagnostics}</code>
        </Box>
        <Typography variant="pi" textColor="neutral600">
          {t('about.diagnostics.note')}
        </Typography>
        <Flex gap={3} alignItems="center" wrap="wrap">
          <Button variant="secondary" size="S" loading={isRunning} onClick={run}>
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
    </>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <Typography tag="dt" variant="sigma" textColor="neutral600">
        {label}
      </Typography>
      <Typography tag="dd" style={{ margin: 0 }}>
        {value}
      </Typography>
    </>
  )
}

function UpdateText({ report }: { report: AboutReport }) {
  const { t } = useMessages()
  const { update } = report
  if (update.state === 'available') {
    return (
      <>
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
    <Button variant="secondary" onClick={copy}>
      {t('about.copy')}
    </Button>
  )
}
