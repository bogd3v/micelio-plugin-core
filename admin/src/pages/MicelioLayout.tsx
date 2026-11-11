import { Box, Typography } from '@strapi/design-system'
import { Layouts, Page, SubNav, useAuth } from '@strapi/strapi/admin'
import { Suspense, lazy, useMemo, type ComponentType } from 'react'
import { useIntl } from 'react-intl'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { styled } from 'styled-components'

import { useAdminPages, type AdminPageItem } from '../hooks/useAdminPages'
import { useInReviewCount } from '../hooks/useInReviewCount'
import { useMessages } from '../messages'
import { CORE_NAV_ITEMS, NAV_GROUPS, visibleNavItems, type NavGroup } from '../navigation'
import { pageLoaderOf } from '../pageRegistry'
import { REVIEW_READ_PERMISSION, STATUS_READ_PERMISSION } from '../permissions'
import { PLUGIN_ID } from '../pluginId'
import { localised } from '../utils/localised'
import AboutPage from './AboutPage'
import BlocksPage from './BlocksPage'
import BuilderPage from './BuilderPage'
import PreviewPage from './PreviewPage'
import ReviewPage from './ReviewPage'
import SitesPage from './SitesPage'
import StatusPage from './StatusPage'
import TemplateBuilderPage from './TemplateBuilderPage'
import TemplatesGalleryPage from './TemplatesGalleryPage'
import TemplatesManagePage from './TemplatesManagePage'
import TransferPage from './TransferPage'

/**
 * The bar on the right edge of the open item (the artboard's `Main`): the link the router marks
 * `aria-current="page"` gets a 3px bar in the design system's primary colour, drawn inside the link
 * so the list's width does not change.
 */
const ActiveBar = styled.div`
  a[aria-current='page'] {
    position: relative;
  }
  a[aria-current='page']::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 3px;
    background: ${({ theme }) => theme.colors.primary600};
  }
`

/**
 * The Micelio section of the admin: its sub-navigation and the page of each item.
 *
 * @remarks
 * The core's items (`navigation.ts`) show to a role that has their permission; the pages of
 * sibling plugins come from `GET /micelio/admin-pages`, which lists only those the admin user has
 * the permission for. A group with nothing to show is left out. A role without the Status
 * permission lands on About. The Sites page (`sites`) renders the panels sibling plugins registered for their site sections.
 * The gallery of templates (`new/:uid`), the template editor (`templates/:id/edit`) and the preview page (`preview/:uid/:documentId`) have no item: the entry's edit view
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
  // The count is read for a role that sees the item, and again at each move inside the section.
  const { pathname } = useLocation()
  const canReadReview = permissions.some(({ action }) => action === REVIEW_READ_PERMISSION.action)
  const inReview = useInReviewCount(!isLoadingPermissions && canReadReview, pathname)
  const linksOf = (group: NavGroup) => [
    ...coreItems
      .filter((item) => item.group === group)
      .map((item) => (
        <SubNav.Link
          key={item.id}
          to={item.to ? `/plugins/${PLUGIN_ID}/${item.to}` : `/plugins/${PLUGIN_ID}`}
          end={!item.to}
          // A no-break space after the label keeps it apart from the number in the text a tool
          // reads ("In review 3"), which the accessible name, "In review, 3 pages", contains.
          label={
            item.id === 'review' && inReview ? `${t('nav.review')}\u00a0` : t(`nav.${item.id}`)
          }
          {...(item.id === 'review' && inReview
            ? {
                'aria-label': t('nav.review.count', { count: inReview }),
                endAction: (
                  <Box
                    aria-hidden
                    background="warning100"
                    hasRadius
                    paddingLeft={2}
                    paddingRight={2}
                  >
                    <Typography variant="pi" fontWeight="bold" textColor="warning700">
                      {inReview}
                    </Typography>
                  </Box>
                ),
              }
            : {})}
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
              .map(({ group, links }) =>
                group === 'about' ? (
                  // No heading: the item sits under a divider (the artboards).
                  <ActiveBar key={group}>
                    <Box paddingLeft={2} paddingRight={2}>
                      <Box
                        paddingTop={2}
                        borderColor="neutral150"
                        borderStyle="solid"
                        borderWidth="1px 0 0 0"
                      >
                        {links}
                      </Box>
                    </Box>
                  </ActiveBar>
                ) : (
                  <ActiveBar key={group}>
                    <SubNav.Section label={t(`nav.group.${group}`)}>{links}</SubNav.Section>
                  </ActiveBar>
                )
              )}
            {hasFailed ? <Typography textColor="neutral600">{t('nav.error')}</Typography> : null}
          </SubNav.Sections>
        </SubNav.Main>
      }
    >
      <Routes>
        <Route index element={canReadStatus ? <StatusPage /> : <Navigate to="about" replace />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="blocks" element={<BlocksPage />} />
        <Route path="sites" element={<SitesPage />} />
        <Route path="_export-import" element={<TransferPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="preview/:uid/:documentId" element={<PreviewPage />} />
        <Route path="builder/:uid/:documentId" element={<BuilderPage />} />
        <Route path="new/:uid" element={<TemplatesGalleryPage />} />
        <Route path="templates" element={<TemplatesManagePage />} />
        <Route path="templates/:id/edit" element={<TemplateBuilderPage />} />
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
