import {
  Box,
  Button,
  Checkbox,
  Flex,
  IconButton,
  Link,
  LinkButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system'
import { Layouts, Page, useAuth } from '@strapi/strapi/admin'
import {
  Suspense,
  lazy,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useIntl } from 'react-intl'
import { NavLink } from 'react-router-dom'
import styled, { css } from 'styled-components'

import type { SiteSectionSummary, SiteWithSections } from '../../../server/src/types/status'
import { useSiteEntry } from '../hooks/useSiteEntry'
import { useSites } from '../hooks/useSites'
import { useMessages } from '../messages'
import { sitePanelLoaderOf, type SitePanelProps } from '../pageRegistry'
import { SITES_READ_PERMISSION, SITES_UPDATE_PERMISSION, TRANSFER_PERMISSION } from '../permissions'
import { localised } from '../utils/localised'
import {
  DEFAULT_LOCALES,
  matchesSearch,
  refusalText,
  type SiteFormValues,
} from '../utils/sitesPage'

const SITE_UID = SITES_READ_PERMISSION.subject
const CREATE_PERMISSION = {
  action: 'plugin::content-manager.explorer.create',
  subject: SITE_UID,
}

// One lazy component per panel name: it is created when a panel is first rendered, so no module is
// fetched for a section the caller cannot read, and a re-render does not load it again.
const lazyPanels = new Map<string, ComponentType<SitePanelProps>>()
function panelComponent(name: string): ComponentType<SitePanelProps> | null {
  const known = lazyPanels.get(name)
  if (known) return known
  const loader = sitePanelLoaderOf(name)
  if (!loader) return null
  const component = lazy(loader)
  lazyPanels.set(name, component)
  return component
}

const Input = styled.input<{ $isMono?: boolean }>`
  box-sizing: border-box;
  width: 100%;
  height: 40px;
  padding: 0 ${({ theme }) => theme.spaces[4]};
  font: inherit;
  font-size: ${({ theme }) => theme.fontSizes[2]};
  font-family: ${({ $isMono }) => ($isMono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit')};
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};

  &:read-only,
  &:disabled {
    color: ${({ theme }) => theme.colors.neutral600};
    background: ${({ theme }) => theme.colors.neutral100};
  }
`

const Select = styled.select`
  box-sizing: border-box;
  width: 100%;
  height: 40px;
  padding: 0 ${({ theme }) => theme.spaces[3]};
  font: inherit;
  font-size: ${({ theme }) => theme.fontSizes[2]};
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};

  &:disabled {
    color: ${({ theme }) => theme.colors.neutral600};
    background: ${({ theme }) => theme.colors.neutral100};
  }
`

const CardHeader = styled(Flex)`
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
`

const Mono = styled.span`
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: ${({ theme }) => theme.fontSizes[1]};
`

const Fields = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: ${({ theme }) => theme.spaces[6]};
`

/* The Design System's table insets its rows by 24px; the artboard's run to the card's edges, with the
   first and the last cell keeping the 24px. */
const tableEdges = css`
  && td:first-of-type,
  && th:first-of-type {
    padding-left: ${({ theme }) => theme.spaces[6]};
  }

  && td:last-of-type,
  && th:last-of-type {
    padding-right: ${({ theme }) => theme.spaces[6]};
  }
`

const Row = styled(Tr)<{ $isSelected: boolean }>`
  background: ${({ $isSelected, theme }) => ($isSelected ? theme.colors.primary100 : 'transparent')};
  ${tableEdges}
`

const HeadRow = styled(Tr)`
  background: ${({ theme }) => theme.colors.neutral100};
  ${tableEdges}

  && th {
    height: 4.2rem;
  }

  && th:last-of-type > * {
    justify-content: flex-end;
  }
`

const can = (
  permissions: { action: string; subject?: string | null }[],
  wanted: { action: string; subject: string | null }
): boolean =>
  permissions.some(
    ({ action, subject }) =>
      action === wanted.action && (wanted.subject === null || subject === wanted.subject)
  )

const entryPath = (documentId: string) =>
  `/content-manager/collection-types/${SITE_UID}/${documentId}`

/** The pencil of the artboard's edit button (drawn here: `@strapi/icons` is not loadable in Node). */
function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10.5 2.5l3 3L6 13l-3.5.5L3 10l7.5-7.5z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The Sites page: the sites in a table, with a search, and the selected site's card: the form of
 * its core fields and, under it, the panel each plugin registered for the sections the caller may
 * read.
 */
export default function SitesPage() {
  const { t } = useMessages()
  return (
    <Page.Protect permissions={[SITES_READ_PERMISSION]}>
      <Page.Main>
        <Page.Title>{t('sites.title')}</Page.Title>
        <SitesContent />
      </Page.Main>
    </Page.Protect>
  )
}

function SitesContent() {
  const { t } = useMessages()
  const { state, reload, refresh } = useSites()
  const permissions = useAuth('SitesPage', (auth) => auth.permissions)
  const [chosen, setChosen] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [focusCount, setFocusCount] = useState(0)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const searchId = useId()

  // The edit button of a row moves focus to the card's title, once the card of that site is shown.
  useEffect(() => {
    if (focusCount > 0) titleRef.current?.focus()
  }, [focusCount])

  const header = (subtitle: string) => (
    <Layouts.Header
      title={t('sites.title')}
      subtitle={subtitle}
      primaryAction={
        can(permissions, CREATE_PERMISSION) ? (
          <LinkButton
            tag={NavLink}
            size="L"
            to={`/content-manager/collection-types/${SITE_UID}/create`}
            startIcon={<PlusIcon />}
          >
            {t('sites.create')}
          </LinkButton>
        ) : undefined
      }
    />
  )

  if (state.kind === 'loading') {
    return (
      <>
        {header('')}
        <Layouts.Content>
          <Page.Loading>{t('sites.loading')}</Page.Loading>
        </Layouts.Content>
      </>
    )
  }
  if (state.kind === 'error') {
    return (
      <>
        {header('')}
        <Layouts.Content>
          <Flex direction="column" alignItems="flex-start" gap={2}>
            <Typography textColor="neutral600">{t('sites.error')}</Typography>
            <Button variant="secondary" size="S" onClick={reload}>
              {t('status.retry')}
            </Button>
          </Flex>
        </Layouts.Content>
      </>
    )
  }
  const { sites, sections } = state.data
  const site = sites.find(({ documentId }) => documentId === chosen) ?? sites[0]
  const shown = sites.filter((candidate) => matchesSearch(candidate, query))
  return (
    <>
      {header(t('sites.subtitle', { count: sites.length }))}
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={6}>
          <Box width="280px" maxWidth="100%">
            <Input
              id={searchId}
              type="search"
              value={query}
              aria-label={t('sites.search.label')}
              placeholder={t('sites.search.placeholder')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </Box>
          <Box background="neutral0" hasRadius shadow="tableShadow" style={{ overflowX: 'auto' }}>
            <Table
              role="table"
              colCount={5}
              rowCount={shown.length + 1}
              aria-label={t('sites.table')}
              style={{ tableLayout: 'fixed', width: 'calc(100% + 48px)', marginInline: '-24px' }}
            >
              <Thead>
                <HeadRow>
                  <Th role="columnheader" style={{ width: '24%' }}>
                    <Typography variant="sigma">{t('sites.column.name')}</Typography>
                  </Th>
                  <Th role="columnheader" style={{ width: '14%' }}>
                    <Typography variant="sigma">{t('sites.column.slug')}</Typography>
                  </Th>
                  <Th role="columnheader" style={{ width: '28%' }}>
                    <Typography variant="sigma">{t('sites.column.hosts')}</Typography>
                  </Th>
                  <Th role="columnheader" style={{ width: '18%' }}>
                    <Typography variant="sigma">{t('sites.column.theme')}</Typography>
                  </Th>
                  <Th role="columnheader" style={{ width: '16%' }}>
                    <Typography variant="sigma">{t('sites.column.actions')}</Typography>
                  </Th>
                </HeadRow>
              </Thead>
              <Tbody>
                {shown.map((row) => (
                  <Row key={row.documentId} $isSelected={row.documentId === site?.documentId}>
                    <Td role="cell">
                      <Flex gap={2} alignItems="center" wrap="wrap">
                        <Typography fontWeight="bold">{row.name}</Typography>
                        {row.isDefault ? (
                          <Box
                            tag="span"
                            background="primary100"
                            hasRadius
                            paddingLeft={2}
                            paddingRight={2}
                          >
                            <Typography variant="sigma" textColor="primary600" tag="span">
                              {t('sites.default')}
                            </Typography>
                          </Box>
                        ) : null}
                      </Flex>
                    </Td>
                    <Td role="cell">
                      <Mono>{row.slug}</Mono>
                    </Td>
                    <Td role="cell">
                      {row.hosts.length > 0 ? (
                        row.hosts.map((host) => (
                          <Typography key={host} tag="div">
                            {host}
                          </Typography>
                        ))
                      ) : (
                        <Typography textColor="neutral600">{t('sites.none.value')}</Typography>
                      )}
                    </Td>
                    <Td role="cell">
                      {row.theme ? (
                        <>
                          <Typography tag="div">{row.theme.id}</Typography>
                          <Typography tag="div" textColor="neutral600">
                            {row.theme.version}
                          </Typography>
                        </>
                      ) : (
                        <Typography textColor="neutral600">{t('sites.none.value')}</Typography>
                      )}
                    </Td>
                    <Td role="cell">
                      <Flex justifyContent="flex-end">
                        <IconButton
                          label={t('sites.edit', { name: row.name })}
                          variant="tertiary"
                          onClick={() => {
                            setChosen(row.documentId)
                            setFocusCount((value) => value + 1)
                          }}
                        >
                          <PencilIcon />
                        </IconButton>
                      </Flex>
                    </Td>
                  </Row>
                ))}
              </Tbody>
            </Table>
            {shown.length === 0 ? (
              <Box padding={4}>
                <Typography role="status" textColor="neutral600">
                  {t('sites.search.empty')}
                </Typography>
              </Box>
            ) : null}
          </Box>
          {site ? (
            <SiteCard
              key={site.documentId}
              site={site}
              sections={sections}
              titleRef={titleRef}
              onSaved={refresh}
            />
          ) : (
            <Typography textColor="neutral600">{t('sites.none')}</Typography>
          )}
        </Flex>
      </Layouts.Content>
    </>
  )
}

function SiteCard(props: {
  site: SiteWithSections
  sections: SiteSectionSummary[]
  titleRef: React.RefObject<HTMLHeadingElement>
  onSaved: () => void
}) {
  const { t } = useMessages()
  const { site, sections, titleRef, onSaved } = props
  const permissions = useAuth('SitesPage', (auth) => auth.permissions)
  const canWrite = can(permissions, SITES_UPDATE_PERMISSION)
  const canExport = can(permissions, TRANSFER_PERMISSION)
  const { state, save } = useSiteEntry(site.documentId)
  const formId = useId()
  const titleId = useId()
  const link = entryPath(site.documentId)
  const [isSaving, setIsSaving] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: true } | { ok: false; text: string } | null>(null)
  const [values, setValues] = useState<SiteFormValues | null>(null)
  const current = values ?? (state.kind === 'ready' ? state.values : null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!current) return
    setIsSaving(true)
    setOutcome(null)
    const result = await save(current)
    setIsSaving(false)
    if (result.ok) {
      setOutcome({ ok: true })
      onSaved()
    } else {
      setOutcome({
        ok: false,
        text: result.refusal === '' ? t('sites.save.failed') : refusalText(result.refusal, t),
      })
    }
  }

  return (
    <Box
      tag="section"
      aria-labelledby={titleId}
      background="neutral0"
      hasRadius
      shadow="filterShadow"
    >
      <CardHeader
        justifyContent="space-between"
        alignItems="flex-start"
        gap={4}
        wrap="wrap"
        padding={6}
      >
        <Flex direction="column" alignItems="flex-start" gap={1} style={{ flex: '1 1 320px' }}>
          <Flex gap={3} alignItems="baseline" wrap="wrap">
            <Typography variant="beta" tag="h2" id={titleId} ref={titleRef} tabIndex={-1}>
              {site.name}
            </Typography>
            <Typography variant="pi">
              <Link tag={NavLink} to={link}>
                {t('sites.card.open')}
              </Link>
            </Typography>
          </Flex>
          <Typography variant="pi" textColor="neutral600">
            {t('sites.card.subtitle')}
          </Typography>
        </Flex>
        <Flex gap={2}>
          {canExport ? (
            <LinkButton
              tag={NavLink}
              variant="tertiary"
              size="L"
              to={`/plugins/micelio/_export-import?site=${encodeURIComponent(site.slug)}`}
            >
              {t('sites.export')}
            </LinkButton>
          ) : null}
          {canWrite && current ? (
            <Button type="submit" size="L" form={formId} loading={isSaving}>
              {t('sites.save')}
            </Button>
          ) : null}
        </Flex>
      </CardHeader>
      <Flex direction="column" alignItems="stretch" gap={6} padding={6}>
        {state.kind === 'loading' ? <Page.Loading>{t('sites.loading')}</Page.Loading> : null}
        {state.kind === 'error' ? (
          <Typography role="alert" textColor="danger600">
            {state.status === 404 ? t('sites.entry.missing') : t('sites.entry.error')}
          </Typography>
        ) : null}
        {current ? (
          <form id={formId} onSubmit={(event) => void submit(event)} aria-labelledby={titleId}>
            <Flex direction="column" alignItems="stretch" gap={6}>
              <SiteFields
                slug={site.slug}
                values={current}
                isReadOnly={!canWrite}
                onChange={setValues}
              />
              {outcome?.ok ? (
                <Typography role="status" textColor="success600">
                  {t('sites.save.done')}
                </Typography>
              ) : null}
              {outcome && !outcome.ok ? (
                <Typography role="alert" textColor="danger600">
                  {outcome.text}
                </Typography>
              ) : null}
            </Flex>
          </form>
        ) : null}
        {sections
          .filter(({ id }) => id in site.sections)
          .map((section) => (
            <SectionPanel
              key={section.id}
              site={site}
              section={section}
              canWrite={canWrite}
              link={link}
            />
          ))}
      </Flex>
    </Box>
  )
}

function Field(props: {
  id: string
  label: string
  help?: string
  isRequired?: boolean
  children: ReactNode
}) {
  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      <label htmlFor={props.id}>
        <Typography variant="pi" fontWeight="bold" tag="span">
          {props.label}
        </Typography>
        {props.isRequired ? (
          <Typography variant="pi" textColor="danger600" tag="span" aria-hidden="true">
            {' *'}
          </Typography>
        ) : null}
      </label>
      {props.children}
      {props.help ? (
        <Typography variant="pi" textColor="neutral600" id={`${props.id}-help`}>
          {props.help}
        </Typography>
      ) : null}
    </Flex>
  )
}

function SiteFields(props: {
  slug: string
  values: SiteFormValues
  isReadOnly: boolean
  onChange: (values: SiteFormValues) => void
}) {
  const { t } = useMessages()
  const { values, isReadOnly, onChange } = props
  const id = useId()
  const set = (patch: Partial<SiteFormValues>) => onChange({ ...values, ...patch })
  return (
    <Fields>
      <Field id={`${id}-name`} label={t('sites.field.name')} isRequired>
        <Input
          id={`${id}-name`}
          value={values.name}
          required
          readOnly={isReadOnly}
          onChange={(event) => set({ name: event.target.value })}
        />
      </Field>
      <Field
        id={`${id}-slug`}
        label={t('sites.field.slug')}
        help={t('sites.field.slug.help', { slug: props.slug })}
        isRequired
      >
        <Input
          id={`${id}-slug`}
          $isMono
          value={values.slug}
          required
          readOnly={isReadOnly}
          aria-describedby={`${id}-slug-help`}
          onChange={(event) => set({ slug: event.target.value })}
        />
      </Field>
      <Field id={`${id}-hosts`} label={t('sites.field.hosts')} help={t('sites.field.hosts.help')}>
        <Input
          id={`${id}-hosts`}
          value={values.hosts}
          readOnly={isReadOnly}
          aria-describedby={`${id}-hosts-help`}
          onChange={(event) => set({ hosts: event.target.value })}
        />
      </Field>
      <Field id={`${id}-locale`} label={t('sites.field.defaultLocale')} isRequired>
        <Select
          id={`${id}-locale`}
          value={values.defaultLocale}
          required
          disabled={isReadOnly}
          onChange={(event) => set({ defaultLocale: event.target.value })}
        >
          {DEFAULT_LOCALES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </Select>
      </Field>
      <Flex
        direction="column"
        alignItems="stretch"
        gap={1}
        role="group"
        aria-labelledby={`${id}-default`}
      >
        <Typography variant="pi" fontWeight="bold" tag="span" id={`${id}-default`}>
          {t('sites.field.isDefault')}
        </Typography>
        <Checkbox
          checked={values.isDefault}
          disabled={isReadOnly}
          onCheckedChange={(checked: boolean | 'indeterminate') =>
            set({ isDefault: checked === true })
          }
        >
          {t('sites.field.isDefault.label')}
        </Checkbox>
      </Flex>
    </Fields>
  )
}

function SectionPanel(props: {
  site: SiteWithSections
  section: SiteSectionSummary
  canWrite: boolean
  link: string
}) {
  const { t } = useMessages()
  const { locale } = useIntl()
  const { site, section, canWrite, link } = props
  const Component = panelComponent(section.panel)
  return (
    <Box tag="section" background="neutral100" hasRadius borderColor="neutral200" padding={4}>
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Typography variant="epsilon" fontWeight="bold" tag="h3">
          {localised(section.label, locale)}
        </Typography>
        {Component ? (
          <Suspense fallback={<Page.Loading>{t('sites.loading')}</Page.Loading>}>
            <Component
              site={{ documentId: site.documentId, slug: site.slug }}
              section={site.sections[section.id] ?? null}
              canWrite={canWrite}
            />
          </Suspense>
        ) : (
          <Typography textColor="neutral600">
            {t('sites.panel.unavailable')}{' '}
            <Link tag={NavLink} to={link}>
              {t('sites.panel.open')}
            </Link>
          </Typography>
        )}
      </Flex>
    </Box>
  )
}
