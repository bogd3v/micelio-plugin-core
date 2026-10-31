import { Box, Button, Flex, Typography } from '@strapi/design-system'
import { useAuth, useFetchClient } from '@strapi/strapi/admin'
import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'

import type {
  TransferOptions,
  TransferRecord,
  ExportDetails,
} from '../../../server/src/types/transfer'
import { useLoaded, type Loaded } from '../hooks/useAsync'
import { useMessages } from '../messages'
import { TRANSFER_PERSONAL_PERMISSION } from '../permissions'
import { formatBytes } from '../utils/transfer'
import { localised } from '../utils/localised'
import { Panel } from './Panel'

/** The parts of the archive the checkboxes switch, by the `scope` key the server takes. */
const PARTS = ['content', 'media', 'settings', 'drafts'] as const
type Part = (typeof PARTS)[number]

/** The format the archive is written in, shown next to its estimated size. */
const FORMAT = 'micelio-site/1'

/** How often the history is read while an export is queued or running, in milliseconds. */
const POLL_MS = 2000

/** The export half of the Export and import page: what to include, the job and the history. */
export function ExportPanel({ site, siteName }: { site: string; siteName: string }) {
  const { t } = useMessages()
  const { locale } = useIntl()
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const permissions = useAuth('ExportPanel', (state) => state.permissions)
  const canPersonal = permissions.some(
    ({ action }) => action === TRANSFER_PERSONAL_PERMISSION.action
  )
  const options = useLoaded<TransferOptions>(`/micelio/transfers/options?site=${site}`)
  const history = useLoaded<TransferRecord[]>(`/micelio/transfers?site=${site}&kind=export`)
  const [scope, setScope] = useState<Record<Part, boolean>>({
    content: true,
    media: true,
    settings: true,
    drafts: true,
  })
  const [isPersonal, setIsPersonal] = useState(false)
  const [included, setIncluded] = useState<string[]>([])
  const [isPreparing, setIsPreparing] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const reloadHistory = history.reload

  const isPending =
    history.resource.kind === 'ready' &&
    history.resource.data.some(({ status }) => status === 'queued' || status === 'running')
  useEffect(() => {
    if (!isPending) return undefined
    const timer = setInterval(reloadHistory, POLL_MS)
    return () => clearInterval(timer)
  }, [isPending, reloadHistory])

  const prepare = async () => {
    setIsPreparing(true)
    setFailure(null)
    try {
      await clientRef.current.post('/micelio/exports', {
        site,
        scope,
        personal: isPersonal,
        include: included,
      })
      reloadHistory()
    } catch {
      setFailure(t('transfer.export.failed'))
    } finally {
      setIsPreparing(false)
    }
  }

  const counts = options.resource.kind === 'ready' ? options.resource.data : null
  const hints: Record<Part, string> = {
    content: counts
      ? t('transfer.export.content.hint', { count: counts.entries })
      : t('transfer.export.loadingHint'),
    media: counts
      ? t('transfer.export.media.hint', {
          count: counts.mediaFiles,
          size: formatBytes(counts.mediaBytes, locale),
        })
      : t('transfer.export.loadingHint'),
    settings: t('transfer.export.settings.hint'),
    drafts: t('transfer.export.drafts.hint'),
  }

  return (
    <Panel title={t('transfer.export.title', { site: siteName })}>
      <Flex
        tag="fieldset"
        direction="column"
        alignItems="stretch"
        gap={3}
        margin={0}
        padding={0}
        style={{ border: 0 }}
      >
        <Typography tag="legend" variant="sigma" textColor="neutral600">
          {t('transfer.export.scope')}
        </Typography>
        {PARTS.map((part) => (
          <Choice
            key={part}
            label={t(`transfer.export.${part}`)}
            hint={hints[part]}
            checked={scope[part]}
            onChange={(checked) => setScope((current) => ({ ...current, [part]: checked }))}
          />
        ))}
        {counts?.hasPersonalTypes || counts?.sections.length ? (
          <Typography variant="sigma" textColor="neutral600" tag="p">
            {t('transfer.export.personalHeading')}
          </Typography>
        ) : null}
        {counts?.hasPersonalTypes ? (
          <Choice
            label={t('transfer.export.personal')}
            hint={
              canPersonal
                ? t('transfer.export.personal.hint')
                : t('transfer.export.personal.denied')
            }
            checked={isPersonal}
            disabled={!canPersonal}
            onChange={setIsPersonal}
          />
        ) : null}
        {counts?.sections.map((section) => (
          <Choice
            key={section.id}
            label={
              typeof section.label === 'string' ? section.label : localised(section.label, locale)
            }
            hint={t('transfer.export.section.hint')}
            checked={included.includes(section.id)}
            onChange={(checked) =>
              setIncluded((current) =>
                checked ? [...current, section.id] : current.filter((id) => id !== section.id)
              )
            }
          />
        ))}
      </Flex>
      <Box background="neutral100" hasRadius padding={4}>
        <Typography tag="p">
          <strong>{t('transfer.export.never.label')}</strong> {t('transfer.export.never')}
        </Typography>
        <Typography tag="p" variant="pi" textColor="neutral600">
          {counts
            ? t('transfer.export.format', {
                format: FORMAT,
                size: formatBytes(estimateOf(counts, scope), locale),
              })
            : null}
        </Typography>
      </Box>
      <Flex direction="column" alignItems="flex-start" gap={2}>
        <Button loading={isPreparing} onClick={prepare}>
          {t('transfer.export.prepare')}
        </Button>
        <Typography variant="pi" textColor="neutral600">
          {t('transfer.export.note')}
        </Typography>
        {failure ? (
          <Typography role="alert" textColor="danger700">
            {failure}
          </Typography>
        ) : null}
      </Flex>
      <History resource={history.resource} onChange={reloadHistory} />
    </Panel>
  )
}

/** The estimated size of what the checkboxes leave in: the media only counts while it is on. */
function estimateOf(counts: TransferOptions, scope: Record<Part, boolean>): number {
  const content = scope.content ? counts.estimatedBytes - counts.mediaBytes : 0
  return content + (scope.media ? counts.mediaBytes : 0)
}

function Choice(props: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
        style={{ marginTop: 4 }}
      />
      <span>
        <Typography fontWeight="bold" tag="span" display="block">
          {props.label}
        </Typography>
        <Typography variant="pi" textColor="neutral600" tag="span" display="block">
          {props.hint}
        </Typography>
      </span>
    </label>
  )
}

function History({
  resource,
  onChange,
}: {
  resource: Loaded<TransferRecord[]>
  onChange: () => void
}) {
  const { t, date } = useMessages()
  const { locale } = useIntl()
  const client = useFetchClient()
  const [failure, setFailure] = useState<string | null>(null)
  if (resource.kind !== 'ready') {
    return resource.kind === 'error' ? (
      <Typography textColor="danger700">{t('transfer.history.error')}</Typography>
    ) : null
  }

  const download = async (record: TransferRecord) => {
    setFailure(null)
    try {
      const response = await client.get<Blob>(`/micelio/exports/${record.downloadToken}/download`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = record.name
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      setFailure(t('transfer.history.downloadFailed'))
      onChange()
    }
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      <Typography variant="sigma" textColor="neutral600" tag="h3">
        {t('transfer.history.title')}
      </Typography>
      {resource.data.length === 0 ? (
        <Typography textColor="neutral600">{t('transfer.history.empty')}</Typography>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {resource.data.map((record) => (
            <li
              key={record.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                padding: '8px 0',
              }}
            >
              <Typography>
                {date(record.createdAt)} · {kindOf(record, t)}
                {record.bytes === null ? '' : ` · ${formatBytes(record.bytes, locale)}`}
              </Typography>
              <Typography textColor="neutral600">
                {record.operator ? `${record.operator} · ` : ''}
                {statusOf(record, t, download)}
              </Typography>
            </li>
          ))}
        </ul>
      )}
      {failure ? (
        <Typography role="alert" textColor="danger700">
          {failure}
        </Typography>
      ) : null}
    </Flex>
  )
}

function kindOf(record: TransferRecord, t: ReturnType<typeof useMessages>['t']): string {
  const details = record.details as ExportDetails | null
  const isFull = details ? PARTS.every((part) => details.scope[part]) : false
  const label = t(isFull ? 'transfer.history.full' : 'transfer.history.partial')
  return details?.personal ? `${label}, ${t('transfer.history.personal')}` : label
}

function statusOf(
  record: TransferRecord,
  t: ReturnType<typeof useMessages>['t'],
  download: (record: TransferRecord) => void
) {
  if (record.status === 'queued' || record.status === 'running') {
    return t(`transfer.history.${record.status}`)
  }
  if (record.status === 'failed') return t('transfer.history.failed')
  if (!record.isAvailable) return t('transfer.history.expired')
  if (!record.downloadToken) return t('transfer.history.otherUser', { name: record.operator ?? '' })
  return (
    <Button variant="tertiary" size="S" onClick={() => download(record)}>
      {t('transfer.history.download', { name: record.name })}
    </Button>
  )
}
