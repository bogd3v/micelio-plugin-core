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
} from '@strapi/design-system'
import { useFetchClient } from '@strapi/strapi/admin'
import { useEffect, useId, useRef, useState } from 'react'
import { useIntl } from 'react-intl'

import type { ExistingPolicy, ImportReport } from '../../../server/src/site-export/importer'
import type { ImportDetails, TransferRecord } from '../../../server/src/types/transfer'
import { useMessages } from '../messages'
import { statusOf as httpStatusOf } from '../utils/fetchError'
import { contentRows, formatBytes, itemsToImport, kindLabel, warningsOf } from '../utils/transfer'
import { Panel } from './Panel'

const POLICIES: ExistingPolicy[] = ['skip', 'update', 'keep-both']

/** What the import half can be showing. */
type Stage =
  | { kind: 'empty' }
  | { kind: 'working' }
  | { kind: 'staged'; record: TransferRecord }
  | { kind: 'applied'; record: TransferRecord }

/** The import half of the Export and import page: the file, the policy, the dry run and the apply. */
export function ImportPanel({ site, siteName }: { site: string; siteName: string }) {
  const { t } = useMessages()
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const input = useRef<HTMLInputElement>(null)
  const policyName = useId()
  const [stage, setStage] = useState<Stage>({ kind: 'empty' })
  const [existing, setExisting] = useState<ExistingPolicy>('skip')
  const [failure, setFailure] = useState<string | null>(null)

  // A staged archive belongs to the site it was checked against.
  useEffect(() => {
    setStage({ kind: 'empty' })
    setFailure(null)
  }, [site])

  const send = async (work: () => Promise<TransferRecord>, kind: 'staged' | 'applied') => {
    const previous = stage
    setStage({ kind: 'working' })
    setFailure(null)
    try {
      setStage({ kind, record: await work() })
    } catch (error) {
      setFailure(messageOf(error, t))
      setStage(previous.kind === 'working' ? { kind: 'empty' } : previous)
    }
  }

  const choose = (file: File | undefined) => {
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    form.append('site', site)
    form.append('existing', existing)
    void send(async () => {
      const response = await clientRef.current.post<{ data: TransferRecord }>(
        '/micelio/imports/dry-run',
        form
      )
      return response.data.data
    }, 'staged')
  }

  const dryRun = (record: TransferRecord, policy: ExistingPolicy) =>
    send(async () => {
      const response = await clientRef.current.post<{ data: TransferRecord }>(
        `/micelio/imports/${record.id}/dry-run`,
        { existing: policy }
      )
      return response.data.data
    }, 'staged')

  const apply = (record: TransferRecord) =>
    send(async () => {
      const response = await clientRef.current.post<{ data: TransferRecord }>(
        `/micelio/imports/${record.id}/apply`,
        { existing }
      )
      return response.data.data
    }, 'applied')

  const pick = (
    <input
      ref={input}
      type="file"
      accept=".gz,.tgz,application/gzip"
      aria-label={t('transfer.import.file')}
      onChange={(event) => {
        choose(event.target.files?.[0])
        event.target.value = ''
      }}
      style={stage.kind === 'empty' ? undefined : { display: 'none' }}
    />
  )

  return (
    <Panel title={t('transfer.import.title', { site: siteName })}>
      {pick}
      {stage.kind === 'empty' ? (
        <Typography textColor="neutral600">{t('transfer.import.empty')}</Typography>
      ) : null}
      {stage.kind === 'working' ? (
        <Typography role="status">{t('transfer.import.working')}</Typography>
      ) : null}
      {failure ? (
        <Typography role="alert" textColor="danger700">
          {failure}
        </Typography>
      ) : null}
      {stage.kind === 'staged' ? (
        <Staged
          record={stage.record}
          policyName={policyName}
          existing={existing}
          onReplace={() => input.current?.click()}
          onPolicy={(policy) => {
            setExisting(policy)
            void dryRun(stage.record, policy)
          }}
          onAgain={() => dryRun(stage.record, existing)}
          onApply={() => apply(stage.record)}
        />
      ) : null}
      {stage.kind === 'applied' ? (
        <Applied record={stage.record} onAnother={() => setStage({ kind: 'empty' })} />
      ) : null}
      <Typography variant="pi" textColor="neutral600">
        {t('transfer.import.note')}
      </Typography>
    </Panel>
  )
}

function messageOf(error: unknown, t: ReturnType<typeof useMessages>['t']): string {
  const body = (error as { response?: { data?: { detail?: string; code?: string } } })?.response
    ?.data
  if (body?.detail) return body.detail
  return httpStatusOf(error) === 403 ? t('transfer.forbidden') : t('transfer.import.failed')
}

function Staged(props: {
  record: TransferRecord
  policyName: string
  existing: ExistingPolicy
  onReplace: () => void
  onPolicy: (policy: ExistingPolicy) => void
  onAgain: () => void
  onApply: () => void
}) {
  const { t } = useMessages()
  const { locale } = useIntl()
  const details = props.record.details as ImportDetails
  const preview = details.preview
  const items = preview ? itemsToImport(preview) : 0
  const warnings = preview ? warningsOf(preview) : []
  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Flex justifyContent="space-between" alignItems="center" gap={3} wrap="wrap">
        <Box>
          <Typography fontWeight="bold" tag="p">
            {props.record.name}
          </Typography>
          <Typography variant="pi" textColor="neutral600" tag="p">
            {t('transfer.import.fileFacts', {
              version: preview?.archive.formatVersion ?? '',
              core: preview?.archive.micelio ?? '',
              size: formatBytes(props.record.bytes ?? 0, locale),
            })}
          </Typography>
        </Box>
        <Button variant="secondary" size="S" onClick={props.onReplace}>
          {t('transfer.import.replace')}
        </Button>
      </Flex>

      <Flex
        tag="fieldset"
        direction="column"
        alignItems="flex-start"
        gap={2}
        margin={0}
        padding={0}
        style={{ border: 0 }}
      >
        <Typography tag="legend" variant="sigma" textColor="neutral600">
          {t('transfer.import.policy')}
        </Typography>
        <Flex gap={4} wrap="wrap">
          {POLICIES.map((policy) => (
            <label key={policy} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="radio"
                name={props.policyName}
                checked={props.existing === policy}
                onChange={() => props.onPolicy(policy)}
              />
              {t(`transfer.import.policy.${policy}`)}
            </label>
          ))}
        </Flex>
        <Typography variant="pi" textColor="neutral600">
          {t(`transfer.import.policy.${props.existing}.hint`)}
        </Typography>
      </Flex>

      {preview ? (
        <>
          <Flex gap={2} alignItems="center">
            <Typography variant="delta" tag="h3">
              {t('transfer.dryRun.title')}
            </Typography>
            <Badge backgroundColor="success100" textColor="success700">
              {t('transfer.dryRun.compatible')}
            </Badge>
          </Flex>
          <PreviewTable record={props.record} />
          {warnings.length > 0 ? (
            <ul>
              {warnings.map((warning) => (
                <li key={warning.id}>
                  <Typography>{t(warning.id, warning.values)}</Typography>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <Typography role="alert" textColor="danger700">
          {t('transfer.import.otherSite', { detail: details.conflict ?? '' })}
        </Typography>
      )}
      <Flex gap={2} wrap="wrap">
        <Button variant="secondary" disabled={!preview} onClick={props.onAgain}>
          {t('transfer.dryRun.again')}
        </Button>
        <Button disabled={!preview || items === 0} onClick={props.onApply}>
          {t('transfer.import.apply', { count: items })}
        </Button>
      </Flex>
    </Flex>
  )
}

/** The dry run's table; its figures are the ones the report repeats once the import is applied. */
function PreviewTable({ record }: { record: TransferRecord }) {
  const { t } = useMessages()
  const preview = (record.details as ImportDetails).preview!
  const site = preview.types.site
  const rows = contentRows(preview)
  const media = preview.media
  return (
    <Table colCount={6} rowCount={rows.length + 4} aria-label={t('transfer.dryRun.title')}>
      <Thead>
        <Tr>
          {['kind', 'inFile', 'create', 'update', 'skip', 'note'].map((column) => (
            <Th key={column}>
              <Typography variant="sigma">{t(`transfer.dryRun.column.${column}`)}</Typography>
            </Th>
          ))}
        </Tr>
      </Thead>
      <Tbody>
        {rows.map((row) => (
          <Cells
            key={row.name}
            kind={kindLabel(row.name)}
            counts={[row.inFile, row.create, row.update, row.skip]}
            note=""
          />
        ))}
        <Cells
          kind={t('transfer.dryRun.media')}
          counts={[media.inFile, media.inFile - media.reused, 0, media.reused]}
          note={t('transfer.dryRun.media.note', { count: media.reused })}
        />
        {site ? (
          <Cells
            kind={t('transfer.dryRun.settings')}
            counts={[site.inFile, site.create, site.update, site.skip]}
            note={t('transfer.dryRun.settings.note')}
          />
        ) : null}
        {preview.theme ? (
          <Cells
            kind={t('transfer.dryRun.theme')}
            counts={[1, 0, 0, 0]}
            note={t(
              preview.theme.matches
                ? 'transfer.dryRun.theme.matches'
                : 'transfer.dryRun.theme.differs',
              {
                theme: `${preview.theme.id}${preview.theme.version ? `@${preview.theme.version}` : ''}`,
              }
            )}
          />
        ) : null}
      </Tbody>
    </Table>
  )
}

function Cells({ kind, counts, note }: { kind: string; counts: number[]; note: string }) {
  return (
    <Tr>
      <Td>
        <Typography fontWeight="bold">{kind}</Typography>
      </Td>
      {counts.map((count, position) => (
        <Td key={position}>
          <Typography>{count}</Typography>
        </Td>
      ))}
      <Td>
        <Typography variant="pi" textColor="neutral600">
          {note}
        </Typography>
      </Td>
    </Tr>
  )
}

/** The report an applied import kept, with the figures of the dry run it was confirmed on. */
function Applied({ record, onAnother }: { record: TransferRecord; onAnother: () => void }) {
  const { t } = useMessages()
  const report = (record.details as ImportDetails).report as ImportReport
  const total = (key: 'created' | 'replaced' | 'skipped') =>
    Object.values(report.types).reduce((sum, counts) => sum + counts[key], 0)
  return (
    <Flex direction="column" alignItems="flex-start" gap={3}>
      <Typography variant="delta" tag="h3">
        {t('transfer.report.title')}
      </Typography>
      <Typography role="status" data-testid="import-report">
        {t('transfer.report.summary', {
          created: total('created'),
          updated: total('replaced'),
          skipped: total('skipped'),
          stored: report.media.stored,
          reused: report.media.reused,
        })}
      </Typography>
      <ul>
        {Object.entries(report.types)
          .filter(([name]) => name !== 'site')
          .map(([name, counts]) => (
            <li key={name}>
              <Typography>
                {t('transfer.report.type', {
                  kind: kindLabel(name),
                  created: counts.created,
                  updated: counts.replaced,
                  skipped: counts.skipped,
                })}
              </Typography>
            </li>
          ))}
      </ul>
      <Button variant="secondary" onClick={onAnother}>
        {t('transfer.report.another')}
      </Button>
    </Flex>
  )
}
