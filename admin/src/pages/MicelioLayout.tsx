import { Typography } from '@strapi/design-system'
import { Layouts, Page, SubNav, useAuth } from '@strapi/strapi/admin'
import { Suspense, lazy, useMemo, type ComponentType } from 'react'
import { useIntl } from 'react-intl'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'

import { useAdminPages, type AdminPageItem } from '../hooks/useAdminPages'
import { useMessages } from '../messages'
import { CORE_NAV_ITEMS, NAV_GROUPS, visibleNavItems, type NavGroup } from '../navigation'
import { pageLoaderOf } from '../pageRegistry'
import { STATUS_READ_PERMISSION } from '../permissions'
import { PLUGIN_ID } from '../pluginId'
import { localised } from '../utils/localised'
import AboutPage from './AboutPage'
import PreviewPage from './PreviewPage'
import StatusPage from './StatusPage'
import TransferPage from './TransferPage'

/**
 * The Micelio section of the admin: its sub-navigation and the page of each item.
 *
 * @remarks
 * The core's items (`navigation.ts`) show to a role that has their permission; the pages of
 * sibling plugins come from `GET /micelio/admin-pages`, which lists only those the admin user has
 * the permission for. A group with nothing to show is left out. A role without the Status
 * permission lands on About. The preview page (`preview/:uid/:documentId`) has no item: the entry's edit view
 * opens it, and its own permission protects it.
 */
export default function MicelioLayout() {
  const { t } = useMessages()
  const { locale } = useIntl()
  const { pages, hasFailed, isLoading } = useAdminPages()
  // The user's permission list, once loaded: `useRBAC` can answer "no" from an empty list while the
  // list is still loading, and the index would then redirect to About for good.
  const isLoadingPermissions = useAuth('MicelioLayout', (state) => state.isLoading)
  const permissions = useAuth('MicelioLayout', (state) => state.permissions)
  const canReadStatus = permissions.some(({ action }) => action === STATUS_READ_PERMISSION.action)
  const coreItems = visibleNavItems(CORE_NAV_ITEMS, permissions)
  const linksOf = (group: NavGroup) => [
    ...coreItems
      .filter((item) => item.group === group)
      .map((item) => (
        <SubNav.Link
          key={item.id}
          to={item.to ? `/plugins/${PLUGIN_ID}/${item.to}` : `/plugins/${PLUGIN_ID}`}
          end={!item.to}
          label={t(`nav.${item.id}`)}
        />
      )),
    ...pages
      .filter((page) => page.group === group)
      .map((page) => (
        <SubNav.Link
          key={page.id}
          to={`/plugins/${PLUGIN_ID}/${page.to}`}
          label={localised(page.label, locale)}
        />
      )),
  ]

  if (isLoadingPermissions) return <Page.Loading />

  return (
    <Layouts.Root
      sideNav={
        <SubNav.Main aria-label={t('nav.label')}>
          <SubNav.Header label={t('nav.title')} />
          <SubNav.Sections>
            {NAV_GROUPS.map((group) => ({ group, links: linksOf(group) }))
              .filter(({ links }) => links.length > 0)
              .map(({ group, links }) => (
                <SubNav.Section key={group} label={t(`nav.group.${group}`)}>
                  {links}
                </SubNav.Section>
              ))}
            {hasFailed ? <Typography textColor="neutral600">{t('nav.error')}</Typography> : null}
          </SubNav.Sections>
        </SubNav.Main>
      }
    >
      <Routes>
        <Route index element={canReadStatus ? <StatusPage /> : <Navigate to="about" replace />} />
        <Route path="_export-import" element={<TransferPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="preview/:uid/:documentId" element={<PreviewPage />} />
        <Route path="*" element={<ExtensionPage pages={pages} isLoading={isLoading} />} />
      </Routes>
    </Layouts.Root>
  )
}

/** The page a sibling plugin provided for the path, or a notice when it provided none. */
function ExtensionPage({ pages, isLoading }: { pages: AdminPageItem[]; isLoading: boolean }) {
  const { t } = useMessages()
  const path = useParams()['*'] ?? ''
  const page = pages.find((candidate) => candidate.to === path)
  const Component = useMemo<ComponentType | null>(() => {
    const loader = page ? pageLoaderOf(page.id) : undefined
    return loader ? lazy(loader) : null
  }, [page])

  if (isLoading) return <Page.Loading />
  if (!Component) {
    return (
      <Page.Main>
        <Page.Title>{t('page.unavailable.title')}</Page.Title>
        <Layouts.Header title={t('page.unavailable.title')} />
        <Layouts.Content>
          <Typography textColor="neutral600">{t('page.unavailable')}</Typography>
        </Layouts.Content>
      </Page.Main>
    )
  }
  return (
    <Suspense fallback={<Page.Loading />}>
      <Component />
    </Suspense>
  )
}
