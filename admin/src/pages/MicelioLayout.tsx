import { Typography } from '@strapi/design-system'
import { Layouts, Page, SubNav } from '@strapi/strapi/admin'
import { Suspense, lazy, useMemo, type ComponentType } from 'react'
import { useIntl } from 'react-intl'
import { Route, Routes, useParams } from 'react-router-dom'

import type { AdminPageGroup } from '../../../server/src/types/extensions'
import { useAdminPages, type AdminPageItem } from '../hooks/useAdminPages'
import { useMessages } from '../messages'
import { pageLoaderOf } from '../pageRegistry'
import { PLUGIN_ID } from '../pluginId'
import { localised } from '../utils/localised'
import StatusPage from './StatusPage'

const GROUPS: AdminPageGroup[] = ['overview', 'content', 'site']

/**
 * The Micelio section of the admin: its sub-navigation and the page of each item.
 *
 * @remarks
 * The core's Status page is the overview; the pages of sibling plugins come from
 * `GET /micelio/admin-pages`, which lists only those the admin user has the permission for.
 */
export default function MicelioLayout() {
  const { t } = useMessages()
  const { locale } = useIntl()
  const { pages, hasFailed, isLoading } = useAdminPages()
  const byGroup = (group: AdminPageGroup) => pages.filter((page) => page.group === group)

  return (
    <Layouts.Root
      sideNav={
        <SubNav.Main aria-label={t('nav.label')}>
          <SubNav.Header label={t('nav.title')} />
          <SubNav.Sections>
            {GROUPS.map((group) => (
              <SubNav.Section key={group} label={t(`nav.group.${group}`)}>
                {[
                  ...(group === 'overview'
                    ? [
                        <SubNav.Link
                          key="status"
                          to={`/plugins/${PLUGIN_ID}`}
                          end
                          label={t('nav.status')}
                        />,
                      ]
                    : []),
                  ...byGroup(group).map((page) => (
                    <SubNav.Link
                      key={page.id}
                      to={`/plugins/${PLUGIN_ID}/${page.to}`}
                      label={localised(page.label, locale)}
                    />
                  )),
                ]}
              </SubNav.Section>
            ))}
            {hasFailed ? <Typography textColor="neutral600">{t('nav.error')}</Typography> : null}
          </SubNav.Sections>
        </SubNav.Main>
      }
    >
      <Routes>
        <Route index element={<StatusPage />} />
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
