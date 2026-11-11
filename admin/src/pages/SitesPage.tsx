import { Button, Flex, Link, Typography } from '@strapi/design-system'
import { Layouts, Page, useAuth } from '@strapi/strapi/admin'
import { Suspense, lazy, useState, type ComponentType } from 'react'
import { useIntl } from 'react-intl'
import { NavLink } from 'react-router-dom'

import type { SiteSectionSummary, SiteWithSections } from '../../../server/src/types/status'
import { Panel } from '../components/Panel'
import { useSites } from '../hooks/useSites'
import { useMessages } from '../messages'
import { sitePanelLoaderOf, type SitePanelProps } from '../pageRegistry'
import { SITES_READ_PERMISSION, SITES_UPDATE_PERMISSION } from '../permissions'
import { localised } from '../utils/localised'

const SITE_UID = SITES_READ_PERMISSION.subject

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

const entryPath = (documentId: string) =>
  `/content-manager/collection-types/${SITE_UID}/${documentId}`

/**
 * The Sites page: one site at a time, with its core fields as links to its Content Manager entry
 * and, under them, the panel each plugin registered for the sections the caller may read.
 */
export default function SitesPage() {
  const { t } = useMessages()
  return (
    <Page.Protect permissions={[SITES_READ_PERMISSION]}>
      <Page.Main>
        <Page.Title>{t('sites.title')}</Page.Title>
        <Layouts.Header title={t('sites.title')} subtitle={t('sites.subtitle')} />
        <Layouts.Content>
          <SitesContent />
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  )
}

function SitesContent() {
  const { t } = useMessages()
  const { state, reload } = useSites()
  const [chosen, setChosen] = useState<string | null>(null)
  if (state.kind === 'loading') return <Page.Loading>{t('sites.loading')}</Page.Loading>
  if (state.kind === 'error') {
    return (
      <Flex direction="column" alignItems="flex-start" gap={2}>
        <Typography textColor="neutral600">{t('sites.error')}</Typography>
        <Button variant="secondary" size="S" onClick={reload}>
          {t('status.retry')}
        </Button>
      </Flex>
    )
  }
  const { sites, sections } = state.data
  const site = sites.find(({ documentId }) => documentId === chosen) ?? sites[0]
  if (!site) return <Typography textColor="neutral600">{t('sites.none')}</Typography>
  return (
    <Flex direction="column" alignItems="stretch" gap={5}>
      <Flex direction="column" alignItems="flex-start" gap={1}>
        <label htmlFor="sites-site">
          <Typography variant="sigma" textColor="neutral600" tag="span">
            {t('sites.site')}
          </Typography>
        </label>
        <select
          id="sites-site"
          value={site.documentId}
          onChange={(event) => setChosen(event.target.value)}
          style={{ padding: 8, minWidth: 240 }}
        >
          {sites.map(({ documentId, name, slug }) => (
            <option key={documentId} value={documentId}>
              {name} ({slug})
            </option>
          ))}
        </select>
      </Flex>
      <Site key={site.documentId} site={site} sections={sections} />
    </Flex>
  )
}

function Site({ site, sections }: { site: SiteWithSections; sections: SiteSectionSummary[] }) {
  const { t } = useMessages()
  const permissions = useAuth('SitesPage', (state) => state.permissions)
  const canWrite = permissions.some(
    ({ action, subject }) =>
      action === SITES_UPDATE_PERMISSION.action && subject === SITES_UPDATE_PERMISSION.subject
  )
  const link = entryPath(site.documentId)
  return (
    <>
      <Panel title={t('sites.core.title')}>
        <dl
          style={{
            margin: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(180px, 1fr) 3fr',
            gap: 12,
          }}
        >
          <Row label={t('sites.core.name')}>
            <Link tag={NavLink} to={link}>
              {site.name}
            </Link>
          </Row>
          <Row label={t('sites.core.slug')}>
            <Link tag={NavLink} to={link}>
              {site.slug}
            </Link>
          </Row>
          <Row label={t('sites.core.hosts')}>
            <Link tag={NavLink} to={link}>
              {site.hosts.length > 0 ? site.hosts.join(', ') : t('sites.core.none')}
            </Link>
          </Row>
          <Row label={t('sites.core.url')}>
            <Link tag={NavLink} to={link}>
              {site.origin ?? t('sites.core.none')}
            </Link>
          </Row>
          <Row label={t('sites.core.default')}>
            <Typography>{site.isDefault ? t('sites.core.yes') : t('sites.core.no')}</Typography>
          </Row>
        </dl>
      </Panel>
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
    </>
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
    <Panel title={localised(section.label, locale)}>
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
    </Panel>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <Typography tag="dt" variant="sigma" textColor="neutral600">
        {label}
      </Typography>
      <Typography tag="dd" style={{ margin: 0 }}>
        {children}
      </Typography>
    </>
  )
}
