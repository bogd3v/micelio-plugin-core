import { Box, Breadcrumbs, Button, Crumb, Flex, Link, Typography } from '@strapi/design-system'
import { Layouts, Page, useAuth, useFetchClient, useNotification } from '@strapi/strapi/admin'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import styled from 'styled-components'

import type { TemplateSummary } from '../../../server/src/types/page-templates'
import { Input } from '../components/builder/fieldStyle'
import { TemplateThumbnail } from '../components/TemplateThumbnail'
import { useLoaded } from '../hooks/useAsync'
import { useTemplateExport } from '../hooks/useTemplateExport'
import { useMessages } from '../messages'
import { TEMPLATES_MANAGE_PERMISSION } from '../permissions'
import { pageTypeName } from '../utils/builder/pageSettings'
import { nameOf, type CatalogueEntry } from '../utils/builder/palette'
import { ANSWER_REFUSALS, outcomeOf } from '../utils/fetchError'
import { builderPagePath } from '../utils/previewAction'
import { blockNamesLine, type TemplateSiteOption } from '../utils/templates'

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
`

const CardBox = styled.div<{ $isSelected: boolean; $isDashed?: boolean }>`
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: ${({ theme }) => theme.colors.neutral0};
  border: ${({ $isDashed }) => ($isDashed ? '2px dashed' : '2px solid')}
    ${({ $isSelected, theme }) => ($isSelected ? theme.colors.primary600 : theme.colors.neutral150)};
  border-radius: 6px;
`

const Pick = styled.button`
  all: unset;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  flex: 1;
  cursor: pointer;
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: -4px;
  }
`

const Preview = styled.div`
  height: 180px;
`

const Tag = styled.span`
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.primary700};
  background: ${({ theme }) => theme.colors.primary100};
`

const SiteSelect = styled.select`
  height: 40px;
  min-width: 220px;
  padding: 0 8px;
  font: inherit;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
`

const EMPTY = ''

/**
 * New page from a template (issue #54, the Templates artboard): the templates of a site as cards
 * drawn from their structure, an empty page, and the button that creates the page and opens it in
 * the builder.
 *
 * @remarks
 * Reached from the create view of a page type (the **New page from a template** action of the edit
 * view) at `/plugins/micelio/new/<uid>`. A page made from a template is a copy: its sample text is
 * greyed in the builder and keeps the page from being published until it is replaced. A role with
 * `plugin::micelio.templates.manage` can also import a template file and export one as JSON.
 */
export default function TemplatesGalleryPage() {
  const { t } = useMessages()
  const { uid = '' } = useParams()
  return (
    <Page.Main>
      <Page.Title>{t('template.gallery.title')}</Page.Title>
      <Gallery uid={uid} />
    </Page.Main>
  )
}

function Gallery({ uid }: { uid: string }) {
  const { t, kb } = useMessages()
  const { locale } = useIntl()
  const navigate = useNavigate()
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const { toggleNotification } = useNotification()
  const permissions = useAuth('TemplatesGalleryPage', (state) => state.permissions)
  const canManage = permissions.some(({ action }) => action === TEMPLATES_MANAGE_PERMISSION.action)
  const sites = useLoaded<TemplateSiteOption[]>(
    `/micelio/templates/sites?uid=${encodeURIComponent(uid)}`
  )
  const [chosenSite, setChosenSite] = useState<string>()
  const siteList = sites.resource.kind === 'ready' ? sites.resource.data : []
  const site = chosenSite ?? siteList.find(({ isDefault }) => isDefault)?.slug ?? siteList[0]?.slug
  const siteName = siteList.find(({ slug }) => slug === site)?.name ?? site ?? EMPTY
  const query = site ? encodeURIComponent(site) : null
  const templates = useLoaded<TemplateSummary[]>(
    query ? `/micelio/templates?site=${query}&uid=${encodeURIComponent(uid)}` : null
  )
  const catalogue = useLoaded<CatalogueEntry[]>(query ? `/micelio/blocks?site=${query}` : null)
  const [selected, setSelected] = useState<string>()
  const [title, setTitle] = useState('')
  const [failure, setFailure] = useState<string>()
  const [isCreating, setIsCreating] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)

  const list = templates.resource.kind === 'ready' ? templates.resource.data : []
  const entries = catalogue.resource.kind === 'ready' ? catalogue.resource.data : []
  const chosen = list.find(({ id }) => id === selected)
  const blockName = useCallback(
    (id: string) => {
      const entry = entries.find((candidate) => candidate.id === id)
      return entry ? nameOf(entry, locale) : id
    },
    [entries, locale]
  )

  // The first template is the one chosen until the editor picks another or the empty page.
  useEffect(() => {
    if (selected === undefined && list.length > 0) setSelected(list[0].id)
  }, [list, selected])
  // A site the chosen template does not belong to leaves nothing chosen.
  useEffect(() => {
    if (selected && selected !== EMPTY && list.length > 0 && !chosen) setSelected(list[0].id)
  }, [list, selected, chosen])

  const contentList = `/content-manager/collection-types/${uid}`

  async function create() {
    if (!site) return
    if (!chosen) {
      navigate(`${contentList}/create`)
      return
    }
    setIsCreating(true)
    setFailure(undefined)
    try {
      const outcome = outcomeOf<{ documentId: string; locale: string | null }>(
        await clientRef.current.post(
          `/micelio/templates/${chosen.id}/pages`,
          { uid, site, title: title.trim() || undefined },
          ANSWER_REFUSALS
        )
      )
      if (outcome.ok) {
        navigate(builderPagePath(uid, outcome.data.documentId, outcome.data.locale))
        return
      }
      setFailure(outcome.detail ?? t('template.gallery.failed'))
    } catch {
      setFailure(t('template.gallery.failed'))
    }
    setIsCreating(false)
  }

  const exportTemplate = useTemplateExport()

  async function importTemplate(file: File) {
    if (!site) return
    let raw: unknown
    try {
      raw = JSON.parse(await file.text())
    } catch {
      toggleNotification({ type: 'danger', message: t('template.gallery.import.notJson') })
      return
    }
    try {
      const outcome = outcomeOf<TemplateSummary>(
        await clientRef.current.post(
          `/micelio/templates/import?site=${encodeURIComponent(site)}`,
          raw,
          ANSWER_REFUSALS
        )
      )
      if (outcome.ok) {
        toggleNotification({
          type: 'success',
          message: t('template.gallery.import.done', { name: outcome.data.name }),
        })
        templates.reload()
        return
      }
      toggleNotification({
        type: 'danger',
        message: outcome.detail ?? t('template.gallery.import.failed'),
      })
    } catch {
      toggleNotification({ type: 'danger', message: t('template.gallery.import.failed') })
    }
  }

  if (sites.resource.kind === 'loading')
    return <Page.Loading>{t('template.gallery.loading')}</Page.Loading>
  if (sites.resource.kind === 'error' || (site === undefined && siteList.length === 0)) {
    return (
      <Layouts.Content>
        <Typography role="alert" textColor="neutral600">
          {t('template.gallery.error')}
        </Typography>
      </Layouts.Content>
    )
  }

  return (
    <>
      <Box paddingLeft={10} paddingRight={10} paddingTop={6}>
        <Breadcrumbs label={t('template.gallery.crumbs')}>
          <Crumb>
            <Link tag={NavLink} to="/content-manager">
              {t('template.gallery.crumb.manager')}
            </Link>
          </Crumb>
          <Crumb>
            <Link tag={NavLink} to={contentList}>
              {pageTypeName(uid.split('.').pop() ?? uid)}
            </Link>
          </Crumb>
          <Crumb isCurrent>{t('template.gallery.crumb.create')}</Crumb>
        </Breadcrumbs>
      </Box>
      <Layouts.Header
        title={t('template.gallery.title')}
        subtitle={t('template.gallery.subtitle', { site: siteName })}
        primaryAction={
          <Flex gap={3} alignItems="flex-end">
            <Flex direction="column" alignItems="flex-start" gap={1}>
              <label htmlFor="templates-site">
                <Typography variant="pi" fontWeight="bold" tag="span">
                  {t('template.gallery.site')}
                </Typography>
              </label>
              <SiteSelect
                id="templates-site"
                value={site}
                onChange={(event) => {
                  setChosenSite(event.target.value)
                  setSelected(undefined)
                }}
              >
                {siteList.map((option) => (
                  <option key={option.slug} value={option.slug}>
                    {option.isDefault
                      ? t('template.gallery.site.default', { site: option.name })
                      : option.name}
                  </option>
                ))}
              </SiteSelect>
            </Flex>
            {canManage ? (
              <>
                <input
                  ref={importInput}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  aria-label={t('template.gallery.import')}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void importTemplate(file)
                  }}
                />
                <Button variant="secondary" onClick={() => importInput.current?.click()}>
                  {t('template.gallery.import')}
                </Button>
              </>
            ) : null}
          </Flex>
        }
      />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={5}>
          {templates.resource.kind === 'error' ? (
            <Typography role="alert" textColor="danger700">
              {t('template.gallery.error')}
            </Typography>
          ) : null}
          <Grid role="radiogroup" aria-label={t('template.gallery.group')}>
            {list.map((template) => {
              const isSelected = template.id === selected
              return (
                <CardBox key={template.id} $isSelected={isSelected}>
                  <Pick
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelected(template.id)}
                  >
                    <Preview>
                      <TemplateThumbnail shapes={template.thumbnail} />
                    </Preview>
                    <Box padding={4}>
                      <Flex justifyContent="space-between" gap={2}>
                        <Typography fontWeight="bold" tag="span">
                          {template.name}
                        </Typography>
                        {template.scope === 'cms' ? (
                          <Tag>{t('template.gallery.scope.cms')}</Tag>
                        ) : null}
                        {isSelected ? <Tag>{t('template.gallery.selected')}</Tag> : null}
                      </Flex>
                      <Typography variant="pi" textColor="neutral600" tag="p">
                        {t('template.gallery.card', {
                          blocks: blockNamesLine(template.blocks, blockName),
                          count: template.blocks.length,
                          kb: kb(template.kb),
                        })}
                      </Typography>
                      {template.description ? (
                        <Typography variant="pi" textColor="neutral600" tag="p">
                          {template.description}
                        </Typography>
                      ) : null}
                    </Box>
                  </Pick>
                  {canManage ? (
                    <Box paddingLeft={4} paddingRight={4} paddingBottom={3}>
                      <Button
                        variant="tertiary"
                        size="S"
                        onClick={() => void exportTemplate(template)}
                        aria-label={t('template.gallery.export', { name: template.name })}
                      >
                        {t('template.gallery.export.label')}
                      </Button>
                    </Box>
                  ) : null}
                </CardBox>
              )
            })}
            <CardBox $isSelected={selected === EMPTY} $isDashed>
              <Pick
                type="button"
                role="radio"
                aria-checked={selected === EMPTY}
                onClick={() => setSelected(EMPTY)}
              >
                <Preview style={{ display: 'grid', placeItems: 'center' }}>
                  <Typography variant="alpha" textColor="neutral600" aria-hidden="true">
                    +
                  </Typography>
                </Preview>
                <Box padding={4}>
                  <Typography fontWeight="bold" tag="span">
                    {t('template.gallery.empty')}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600" tag="p">
                    {t('template.gallery.empty.help')}
                  </Typography>
                </Box>
              </Pick>
            </CardBox>
            <Box background="neutral0" padding={4} hasRadius style={{ gridColumn: 'span 2' }}>
              <Typography fontWeight="bold" tag="p">
                {t('template.gallery.data.title')}
              </Typography>
              <Typography variant="pi" textColor="neutral600" tag="p">
                {t('template.gallery.data.body')}
              </Typography>
            </Box>
          </Grid>
          {chosen ? (
            <Flex direction="column" alignItems="flex-start" gap={1}>
              <label htmlFor="template-page-title">
                <Typography variant="pi" fontWeight="bold" tag="span">
                  {t('template.gallery.pageTitle')}
                </Typography>
              </label>
              <Input
                id="template-page-title"
                value={title}
                maxLength={120}
                style={{ maxWidth: 420 }}
                placeholder={chosen.name}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Flex>
          ) : null}
          {failure ? (
            <Typography role="alert" textColor="danger700">
              {failure}
            </Typography>
          ) : null}
          <Flex justifyContent="flex-end" gap={3}>
            <Button variant="tertiary" onClick={() => navigate(contentList)}>
              {t('template.gallery.cancel')}
            </Button>
            <Button
              onClick={() => void create()}
              loading={isCreating}
              disabled={selected === undefined}
            >
              {chosen
                ? t('template.gallery.create', { name: chosen.name })
                : t('template.gallery.createEmpty')}
            </Button>
          </Flex>
        </Flex>
      </Layouts.Content>
    </>
  )
}
