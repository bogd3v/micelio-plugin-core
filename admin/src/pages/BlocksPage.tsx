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
import { Layouts, Page, useAuth, useFetchClient } from '@strapi/strapi/admin'
import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'

import { BlockDrawer } from '../components/BlockDrawer'
import { useLoaded } from '../hooks/useAsync'
import { hasMessage, useMessages } from '../messages'
import { BLOCKS_MANAGE_PERMISSION, BLOCKS_READ_PERMISSION } from '../permissions'
import {
  allowedIn,
  pageTypeLabel,
  blockName,
  countEnabled,
  filterBlocks,
  schemaDocument,
  type CatalogueView,
  type Family,
} from '../utils/blocks'
import { problemOf } from '../utils/fetchError'

interface SiteOption {
  slug: string
  name: string
  isDefault: boolean
}

const FAMILIES: Family[] = ['all', 'section', 'article']

/**
 * The Block catalogue (issue #51): the blocks of the contract, and what one site manages of them:
 * which are enabled, on which page types, and the options a new block starts with.
 */
export default function BlocksPage() {
  const { t } = useMessages()
  return (
    <Page.Protect permissions={[BLOCKS_READ_PERMISSION]}>
      <Page.Main>
        <Page.Title>{t('blocks.title')}</Page.Title>
        <Layouts.Header title={t('blocks.title')} subtitle={t('blocks.subtitle', { count: 19 })} />
        <Layouts.Content>
          <BlocksContent />
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  )
}

function BlocksContent() {
  const { t } = useMessages()
  const sites = useLoaded<SiteOption[]>('/micelio/block-settings/sites')
  const [chosen, setChosen] = useState<string | null>(null)
  if (sites.resource.kind === 'loading') return <Page.Loading>{t('blocks.loading')}</Page.Loading>
  if (sites.resource.kind === 'error') {
    return (
      <Flex direction="column" alignItems="flex-start" gap={2}>
        <Typography textColor="neutral600">{t('blocks.error.sites')}</Typography>
        <Button variant="secondary" size="S" onClick={sites.reload}>
          {t('status.retry')}
        </Button>
      </Flex>
    )
  }
  const options = sites.resource.data
  const site = options.find(({ slug }) => slug === chosen) ?? options[0]
  if (!site) return <Typography textColor="neutral600">{t('blocks.noSites')}</Typography>
  return (
    <Flex direction="column" alignItems="stretch" gap={5}>
      <Flex gap={4} alignItems="flex-end" wrap="wrap">
        <Flex direction="column" alignItems="flex-start" gap={1}>
          <label htmlFor="blocks-site">
            <Typography variant="sigma" textColor="neutral600" tag="span">
              {t('blocks.site')}
            </Typography>
          </label>
          <select
            id="blocks-site"
            value={site.slug}
            onChange={(event) => setChosen(event.target.value)}
            style={{ padding: 8, minWidth: 240 }}
          >
            {options.map(({ slug, name }) => (
              <option key={slug} value={slug}>
                {name} ({slug})
              </option>
            ))}
          </select>
        </Flex>
        <DownloadSchema />
      </Flex>
      <Catalogue key={site.slug} site={site.slug} />
    </Flex>
  )
}

// The contract's schemas are the core's, so they come from the catalogue route, not from the site's view.
function DownloadSchema() {
  const { t } = useMessages()
  const client = useFetchClient()
  const [hasFailed, setHasFailed] = useState(false)
  const download = async () => {
    setHasFailed(false)
    try {
      const { data } = await client.get<{ data: { id: string; schema: unknown }[] }>(
        '/micelio/blocks'
      )
      const url = URL.createObjectURL(
        new Blob([schemaDocument(data.data)], { type: 'application/schema+json' })
      )
      const link = document.createElement('a')
      link.href = url
      link.download = 'blocks.schema.json'
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      setHasFailed(true)
    }
  }
  return (
    <Flex direction="column" alignItems="flex-start" gap={1}>
      <Button variant="tertiary" onClick={download}>
        {t('blocks.download')}
      </Button>
      {hasFailed ? <Typography role="alert">{t('blocks.error.download')}</Typography> : null}
    </Flex>
  )
}

function Catalogue({ site }: { site: string }) {
  const { t } = useMessages()
  const { locale } = useIntl()
  const client = useFetchClient()
  const permissions = useAuth('BlocksPage', (state) => state.permissions)
  const canManage = permissions.some(({ action }) => action === BLOCKS_MANAGE_PERMISSION.action)
  const view = useLoaded<CatalogueView>(`/micelio/block-settings?site=${encodeURIComponent(site)}`)
  // The table stays on screen while it is read again, and a switch changes its row in place: a
  // reload that unmounted it would drop the keyboard focus and what the open drawer holds.
  const [data, setData] = useState<CatalogueView>()
  useEffect(() => {
    if (view.resource.kind === 'ready') setData(view.resource.data)
  }, [view.resource])
  const [search, setSearch] = useState('')
  const [family, setFamily] = useState<Family>('all')
  const [islandsOnly, setIslandsOnly] = useState(false)
  const [disabledOnly, setDisabledOnly] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [problem, setProblem] = useState<string>()

  if (!data && view.resource.kind !== 'error') {
    return <Page.Loading>{t('blocks.loading')}</Page.Loading>
  }
  if (!data) {
    return (
      <Flex direction="column" alignItems="flex-start" gap={2}>
        <Typography textColor="neutral600">{t('blocks.error.load')}</Typography>
        <Button variant="secondary" size="S" onClick={view.reload}>
          {t('status.retry')}
        </Button>
      </Flex>
    )
  }
  const { blocks, pageTypes } = data
  const shown = filterBlocks(blocks, { search, family, islandsOnly, disabledOnly })
  const { disabled, enabled } = countEnabled(blocks)
  const selected = blocks.find((block) => block.id === open)

  const toggle = async (id: string, isEnabled: boolean) => {
    setProblem(undefined)
    try {
      const { data: saved } = await client.put<{ data: { enabled: boolean } }>(
        `/micelio/block-settings/${id}?site=${encodeURIComponent(site)}`,
        { enabled: isEnabled }
      )
      setData(
        (current) =>
          current && {
            ...current,
            blocks: current.blocks.map((block) =>
              block.id === id ? { ...block, enabled: saved.data.enabled } : block
            ),
          }
      )
    } catch (error) {
      setProblem(problemOf(error)?.detail ?? t('blocks.error.save'))
    }
  }

  return (
    <Flex gap={6} alignItems="flex-start" wrap="wrap">
      <Flex
        direction="column"
        alignItems="stretch"
        gap={4}
        style={{ flex: '1 1 960px', minWidth: 0 }}
      >
        <Flex gap={4} alignItems="flex-end" wrap="wrap">
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Typography variant="sigma" textColor="neutral600" tag="span">
              {t('blocks.filter.search')}
            </Typography>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ padding: 8, minWidth: 200 }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Typography variant="sigma" textColor="neutral600" tag="span">
              {t('blocks.filter.family')}
            </Typography>
            <select
              value={family}
              onChange={(event) => setFamily(event.target.value as Family)}
              style={{ padding: 8 }}
            >
              {FAMILIES.map((value) => (
                <option key={value} value={value}>
                  {t(`blocks.family.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={islandsOnly}
              onChange={(e) => setIslandsOnly(e.target.checked)}
            />
            <Typography tag="span">{t('blocks.filter.islands')}</Typography>
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={disabledOnly}
              onChange={(e) => setDisabledOnly(e.target.checked)}
            />
            <Typography tag="span">{t('blocks.filter.disabled')}</Typography>
          </label>
          <Typography tag="p" textColor="neutral700" data-testid="block-counts">
            {t('blocks.counts', { disabled, enabled, site })}
          </Typography>
        </Flex>

        {problem ? (
          <Typography role="alert" textColor="danger700">
            {problem}
          </Typography>
        ) : null}

        <Table colCount={7} rowCount={shown.length + 1}>
          <Thead>
            <Tr>
              {['on', 'block', 'allowed', 'options', 'cost', 'kind', 'used'].map((column) => (
                <Th key={column}>
                  <Typography variant="sigma">{t(`blocks.column.${column}`)}</Typography>
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {shown.map((block) => {
              const names = Object.keys(block.options)
              const name = blockName(block, locale)
              return (
                <Tr
                  key={block.id}
                  data-testid={`block-row-${block.id}`}
                  style={{ background: block.enabled ? undefined : '#f6f6f9' }}
                >
                  <Td>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={block.enabled}
                      disabled={!canManage}
                      aria-label={`${name}: ${t(block.enabled ? 'blocks.enabledOn' : 'blocks.disabledOn', { site })}`}
                      onChange={(event) => void toggle(block.id, event.target.checked)}
                    />
                  </Td>
                  <Td>
                    <Flex direction="column" alignItems="flex-start" gap={1}>
                      <Button variant="ghost" size="S" onClick={() => setOpen(block.id)}>
                        {name}
                      </Button>
                      <Typography variant="pi" textColor="neutral600">
                        <code>{block.component}</code>
                      </Typography>
                    </Flex>
                  </Td>
                  <Td>
                    <Typography>
                      {allowedIn(block, pageTypes)
                        .map((type) => pageTypeLabel(type, t, hasMessage))
                        .join(', ') || t('blocks.nowhere')}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography>
                      {names.length
                        ? `${names.join(', ')} · ${t('blocks.optionCount', { count: names.length })}`
                        : '—'}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography>{block.costKb} kB</Typography>
                  </Td>
                  <Td>
                    <Badge
                      backgroundColor={block.isIsland ? 'warning100' : 'neutral150'}
                      textColor="neutral800"
                    >
                      {t(block.isIsland ? 'blocks.kind.island' : 'blocks.kind.static')}
                    </Badge>
                  </Td>
                  <Td>
                    <Button variant="ghost" size="S" onClick={() => setOpen(block.id)}>
                      {t('blocks.pages', { count: block.used })}
                    </Button>
                  </Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
        <Box>
          <Typography tag="p" textColor="neutral600">
            {t('blocks.showing', { shown: shown.length, total: blocks.length })}
          </Typography>
          <Typography tag="p" textColor="neutral600">
            {t('blocks.footer')}
          </Typography>
        </Box>
      </Flex>
      {selected ? (
        <Box style={{ flex: '0 1 440px', minWidth: 320 }}>
          <BlockDrawer
            key={`${selected.id}:${JSON.stringify([selected.allowedPageTypes, selected.defaultOptions, selected.labels])}`}
            block={selected}
            site={site}
            pageTypes={pageTypes}
            canManage={canManage}
            onSaved={view.reload}
            onClose={() => setOpen(null)}
          />
        </Box>
      ) : null}
    </Flex>
  )
}
