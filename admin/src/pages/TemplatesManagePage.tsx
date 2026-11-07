import {
  Box,
  Button,
  Flex,
  Link,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system'
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { NavLink, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import type { TemplateManaged } from '../../../server/src/types/page-templates'
import { TemplateThumbnail } from '../components/TemplateThumbnail'
import { useLoaded } from '../hooks/useAsync'
import { useTemplateExport } from '../hooks/useTemplateExport'
import { useMessages } from '../messages'
import { TEMPLATES_MANAGE_PERMISSION } from '../permissions'
import { PLUGIN_ID } from '../pluginId'
import { pageTypeName } from '../utils/builder/pageSettings'
import { nameOf, type CatalogueEntry } from '../utils/builder/palette'
import { ANSWER_REFUSALS, outcomeOf } from '../utils/fetchError'
import { builderPagePath } from '../utils/previewAction'
import { causeLine, changeLine } from '../utils/templateChanges'
import { optionsLine, type TemplateSiteOption } from '../utils/templates'

const Layout = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 24px;
`

const Panel = styled.aside`
  flex: none;
  width: 360px;
  box-sizing: border-box;
  background: ${({ theme }) => theme.colors.neutral0};
  border-radius: 6px;
  box-shadow: ${({ theme }) => theme.shadows.tableShadow};
`

const Pick = styled.button<{ $isRetired: boolean }>`
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  opacity: ${({ $isRetired }) => ($isRetired ? 0.6 : 1)};
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 2px;
  }
`

const Thumb = styled.div`
  flex: none;
  width: 48px;
  height: 36px;
  overflow: hidden;
  border-radius: 4px;
`

const Tag = styled.span<{ $isTheme?: boolean; $isFixed?: boolean }>`
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  color: ${({ $isTheme, $isFixed, theme }) =>
    $isFixed
      ? theme.colors.primary700
      : $isTheme
        ? theme.colors.secondary700
        : theme.colors.neutral700};
  background: ${({ $isTheme, $isFixed, theme }) =>
    $isFixed
      ? theme.colors.primary100
      : $isTheme
        ? theme.colors.secondary100
        : theme.colors.neutral150};
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

const Row = styled(Tr)<{ $isSelected: boolean }>`
  background: ${({ $isSelected, theme }) => ($isSelected ? theme.colors.primary100 : 'transparent')};
`

const SectionTitle = styled.h3`
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
`

/**
 * Page templates (issue #55, the Page templates artboard): the templates of a site with where each
 * was used, its structure, the pages made from it and its history, and what a holder of
 * `plugin::micelio.templates.manage` can do with one: edit it in the builder, duplicate it, export
 * its JSON and retire it.
 *
 * @remarks
 * Retiring hides a template from **New page**; the pages made from it are untouched. A template a
 * theme ships is read-only: duplicate it to change it. Making a template, importing one and the
 * gallery are issue #54's (`TemplatesGalleryPage`).
 */
export default function TemplatesManagePage() {
  const { t } = useMessages()
  return (
    <Page.Main>
      <Page.Title>{t('template.manage.title')}</Page.Title>
      <Page.Protect permissions={[TEMPLATES_MANAGE_PERMISSION]}>
        <Manage />
      </Page.Protect>
    </Page.Main>
  )
}

function Manage() {
  const { t, kb } = useMessages()
  const { locale, formatDate } = useIntl()
  const navigate = useNavigate()
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const { toggleNotification } = useNotification()
  const exportTemplate = useTemplateExport()
  const sites = useLoaded<TemplateSiteOption[]>('/micelio/templates/sites')
  const [chosenSite, setChosenSite] = useState<string>()
  const siteList = sites.resource.kind === 'ready' ? sites.resource.data : []
  const site = chosenSite ?? siteList.find(({ isDefault }) => isDefault)?.slug ?? siteList[0]?.slug
  const query = site ? encodeURIComponent(site) : null
  const templates = useLoaded<TemplateManaged[]>(
    query ? `/micelio/templates/manage?site=${query}` : null
  )
  const catalogue = useLoaded<CatalogueEntry[]>(query ? `/micelio/blocks?site=${query}` : null)
  const [selected, setSelected] = useState<string>()
  const [isBusy, setIsBusy] = useState(false)
  const loaded = templates.resource.kind === 'ready' ? templates.resource.data : []
  // A retired template goes last, as in the artboard, so the one shown first is in use.
  const list = useMemo(
    () => [...loaded].sort((a, b) => Number(a.retired === true) - Number(b.retired === true)),
    [loaded]
  )
  const chosen = list.find(({ id }) => id === selected)
  const entries = catalogue.resource.kind === 'ready' ? catalogue.resource.data : []
  const blockName = useCallback(
    (id: string) => {
      const entry = entries.find((candidate) => candidate.id === id)
      return entry ? nameOf(entry, locale) : id
    },
    [entries, locale]
  )
  const day = (iso: string) => formatDate(iso, { dateStyle: 'medium' })
  const siteName = (slug: string) => siteList.find((option) => option.slug === slug)?.name ?? slug

  // The first template is the one shown until the editor picks another.
  useEffect(() => {
    if (list.length > 0 && selected === undefined) setSelected(list[0].id)
  }, [list, selected])

  async function act(path: string, body: unknown) {
    setIsBusy(true)
    try {
      const outcome = outcomeOf<{ id: string }>(
        await clientRef.current.post(path, body, ANSWER_REFUSALS)
      )
      if (outcome.ok) return outcome.data
      toggleNotification({ type: 'danger', message: outcome.detail ?? t('template.manage.failed') })
    } catch {
      toggleNotification({ type: 'danger', message: t('template.manage.failed') })
    } finally {
      setIsBusy(false)
    }
    return undefined
  }

  async function duplicate(template: TemplateManaged) {
    const copy = await act(`/micelio/templates/${template.id}/duplicate?site=${query}`, {})
    if (!copy) return
    toggleNotification({
      type: 'success',
      message: t('template.manage.duplicated', { name: template.name }),
    })
    setSelected(copy.id)
    templates.reload()
  }

  async function retire(template: TemplateManaged) {
    const done = await act(`/micelio/templates/${template.id}/retire`, {
      retired: !template.retired,
    })
    if (done) templates.reload()
  }

  if (sites.resource.kind === 'loading') {
    return <Page.Loading>{t('template.manage.loading')}</Page.Loading>
  }
  if (sites.resource.kind === 'error' || site === undefined) {
    return (
      <Layouts.Content>
        <Typography role="alert" textColor="neutral600">
          {t('template.manage.error')}
        </Typography>
      </Layouts.Content>
    )
  }

  return (
    <>
      <Layouts.Header
        title={t('template.manage.title')}
        subtitle={t('template.manage.subtitle')}
        primaryAction={
          <Flex direction="column" alignItems="flex-start" gap={1}>
            <label htmlFor="templates-manage-site">
              <Typography variant="pi" fontWeight="bold" tag="span">
                {t('template.gallery.site')}
              </Typography>
            </label>
            <SiteSelect
              id="templates-manage-site"
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
        }
      />
      <Layouts.Content>
        {templates.resource.kind === 'error' ? (
          <Typography role="alert" textColor="danger700">
            {t('template.manage.error')}
          </Typography>
        ) : null}
        <Layout>
          <Box
            background="neutral0"
            hasRadius
            shadow="tableShadow"
            style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}
          >
            <Table colCount={5} rowCount={list.length} aria-label={t('template.manage.table')}>
              <Thead>
                <Tr>
                  <Th>
                    <Typography variant="sigma">{t('template.manage.column.template')}</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">{t('template.manage.column.pageTypes')}</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">{t('template.manage.column.blocks')}</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">{t('template.manage.column.source')}</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">{t('template.manage.column.usage')}</Typography>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {list.map((template) => {
                  const created = template.history[template.history.length - 1]
                  const fixed = template.blocks.filter((block) => block.fixed).length
                  return (
                    <Row key={template.id} $isSelected={template.id === selected}>
                      <Td>
                        <Pick
                          type="button"
                          $isRetired={template.retired}
                          aria-pressed={template.id === selected}
                          onClick={() => setSelected(template.id)}
                        >
                          <Thumb aria-hidden="true">
                            <TemplateThumbnail shapes={template.thumbnail} />
                          </Thumb>
                          <span>
                            <Typography fontWeight="bold" tag="span">
                              {template.name}
                            </Typography>
                            <Typography
                              variant="pi"
                              textColor="neutral600"
                              tag="span"
                              style={{ display: 'block' }}
                            >
                              {template.origin === 'theme'
                                ? t('template.manage.byTheme')
                                : created
                                  ? t('template.manage.by', {
                                      by: created.by ?? t('template.manage.unknown'),
                                      date: day(created.at),
                                    })
                                  : ''}
                              {template.retired ? ` · ${t('template.manage.retired')}` : ''}
                            </Typography>
                          </span>
                        </Pick>
                      </Td>
                      <Td>
                        <Typography>
                          {template.pageTypes.map(pageTypeName).join(', ') || '—'}
                        </Typography>
                      </Td>
                      <Td>
                        <Typography>
                          {fixed > 0
                            ? t('template.manage.blocks.fixed', {
                                count: template.blocks.length,
                                fixed,
                              })
                            : template.blocks.length}
                        </Typography>
                      </Td>
                      <Td>
                        {template.origin === 'theme' ? (
                          <Tag $isTheme>{t('template.manage.theme')}</Tag>
                        ) : (
                          <Typography>
                            {template.scope === 'cms'
                              ? t('template.gallery.scope.cms')
                              : siteName(template.site)}
                          </Typography>
                        )}
                      </Td>
                      <Td>
                        <Typography>
                          {t('template.manage.usage', { count: template.usage.count })}
                        </Typography>
                      </Td>
                    </Row>
                  )
                })}
              </Tbody>
            </Table>
            {list.length === 0 && templates.resource.kind === 'ready' ? (
              <Box padding={4}>
                <Typography textColor="neutral600">{t('template.manage.empty')}</Typography>
              </Box>
            ) : null}
            <Box
              padding={4}
              borderColor="neutral150"
              style={{ borderTopWidth: 1, borderTopStyle: 'solid' }}
            >
              <Typography variant="pi" textColor="neutral600" tag="p">
                {t('template.manage.footnote')}
              </Typography>
            </Box>
          </Box>

          {chosen ? (
            <Panel aria-label={t('template.manage.panel', { name: chosen.name })}>
              <Flex justifyContent="space-between" alignItems="flex-start" gap={3} padding={5}>
                <div>
                  <Typography variant="delta" tag="h2" fontWeight="bold">
                    {chosen.name}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600" tag="p">
                    {t('template.manage.panel.meta', {
                      site:
                        chosen.scope === 'cms'
                          ? t('template.gallery.scope.cms')
                          : siteName(chosen.site),
                      types: chosen.pageTypes.map(pageTypeName).join(', ') || '—',
                      version: chosen.version,
                    })}
                  </Typography>
                </div>
                <Button
                  variant="secondary"
                  disabled={chosen.origin === 'theme' || isBusy}
                  onClick={() => navigate(`/plugins/${PLUGIN_ID}/templates/${chosen.id}/edit`)}
                >
                  {t('template.manage.edit')}
                </Button>
              </Flex>
              <Box padding={5} style={{ display: 'grid', gap: 20 }}>
                <div
                  style={{ height: 150, overflow: 'hidden', borderRadius: 4 }}
                  aria-hidden="true"
                >
                  <TemplateThumbnail shapes={chosen.thumbnail} />
                </div>
                <section>
                  <SectionTitle>{t('template.manage.structure')}</SectionTitle>
                  <ol
                    style={{
                      margin: 0,
                      paddingLeft: 20,
                      fontSize: 13,
                      listStyle: 'decimal',
                      display: 'grid',
                      gap: 4,
                    }}
                  >
                    {chosen.blocks.map((block, index) => (
                      <li key={index}>
                        {blockName(block.block)}{' '}
                        <Typography variant="pi" textColor="neutral600" tag="span">
                          {[
                            optionsLine(block.options),
                            t(`template.manage.content.${block.content}`),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                          {block.fixed ? ' · ' : ''}
                        </Typography>
                        {block.fixed ? <Tag $isFixed>{t('template.manage.fixed')}</Tag> : null}
                      </li>
                    ))}
                  </ol>
                  <Typography variant="pi" textColor="neutral600" tag="p" style={{ marginTop: 8 }}>
                    {t('template.manage.weight', { kb: kb(chosen.kb) })}
                  </Typography>
                </section>
                <section>
                  <SectionTitle>{t('template.manage.pages')}</SectionTitle>
                  {chosen.usage.pages.length === 0 ? (
                    <Typography variant="pi" textColor="neutral600" tag="p">
                      {t('template.manage.pages.none')}
                    </Typography>
                  ) : (
                    <ul
                      style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}
                    >
                      {chosen.usage.pages.map((page) => (
                        <li key={`${page.documentId}-${page.locale}`} style={{ fontSize: 13 }}>
                          <Link
                            tag={NavLink}
                            to={builderPagePath(page.uid, page.documentId, page.locale)}
                            style={{ textDecoration: 'none' }}
                          >
                            {page.title}
                          </Link>{' '}
                          <Typography variant="pi" textColor="neutral600" tag="span">
                            v{page.version} · {t(`template.manage.state.${page.state}`)}
                          </Typography>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Typography variant="pi" textColor="neutral600" tag="p" style={{ marginTop: 8 }}>
                    {t('template.manage.pages.help')}
                  </Typography>
                </section>
                <section>
                  <SectionTitle>{t('template.manage.history')}</SectionTitle>
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: 'none',
                      display: 'grid',
                      gap: 6,
                      fontSize: 13,
                    }}
                  >
                    {chosen.history.map((revision) => (
                      <li key={revision.version}>
                        <strong>v{revision.version}</strong> · {day(revision.at)} ·{' '}
                        {revision.changes.length > 0
                          ? revision.changes
                              .map((change) => changeLine(t, change, blockName))
                              .join('; ')
                          : causeLine(t, revision)}
                        {revision.by ? ` · ${revision.by}` : ''}
                      </li>
                    ))}
                  </ul>
                </section>
              </Box>
              <Flex gap={2} padding={5} borderColor="neutral150" style={{ borderTop: '1px solid' }}>
                <Button
                  variant="secondary"
                  disabled={isBusy}
                  onClick={() => void duplicate(chosen)}
                >
                  {t('template.manage.duplicate')}
                </Button>
                <Button variant="secondary" onClick={() => void exportTemplate(chosen)}>
                  {t('template.gallery.export.label')}
                </Button>
                <Button
                  variant={chosen.retired ? 'secondary' : 'danger-light'}
                  disabled={chosen.origin === 'theme' || isBusy}
                  onClick={() => void retire(chosen)}
                  style={{ marginLeft: 'auto' }}
                >
                  {chosen.retired ? t('template.manage.restore') : t('template.manage.retire')}
                </Button>
              </Flex>
            </Panel>
          ) : null}
        </Layout>
      </Layouts.Content>
    </>
  )
}
