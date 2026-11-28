import { Box, Button, Flex, Tabs, Typography } from '@strapi/design-system'
import { Layouts, Page } from '@strapi/strapi/admin'
import { useSearchParams } from 'react-router-dom'
import styled from 'styled-components'

import type { ThemesAnswer } from '../../../server/src/types/themes'
import { Notice } from '../components/Notice'
import { ThemeCard } from '../components/ThemeCard'
import { ThemeChangeNotice } from '../components/ThemeChangeNotice'
import { useThemeChange, type ThemeChange } from '../hooks/useThemeChange'
import { useThemes } from '../hooks/useThemes'
import { useMessages } from '../messages'
import { THEMES_MANAGE_PERMISSION } from '../permissions'
import { PLUGIN_ID } from '../pluginId'
import {
  isActive,
  needsRebuild,
  themeCards,
  themeLabel,
  themeOfPin,
  type ThemeCardKind,
  type ThemeCardModel,
} from '../utils/themes'

// Two cards a row, as the artboard lays them out; one on a narrow screen.
const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${({ theme }) => theme.spaces[4]};
  @media (max-width: 62rem) {
    grid-template-columns: minmax(0, 1fr);
  }
`

// The artboard's tabs: the Design System's, underlined, in sentence case and the body size.
const TabList = styled(Tabs.List)`
  gap: 0.4rem;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral200};
`

const Tab = styled(Tabs.Trigger)`
  && {
    height: 4rem;
    padding-block: 0;
    padding-inline: 1.4rem;
    color: ${({ theme }) => theme.colors.neutral600};
  }
  && > span:first-of-type {
    font-size: 1.4rem;
    font-weight: 400;
    line-height: 1.5;
    text-transform: none;
    color: inherit;
  }
  &&[data-state='active'] {
    color: ${({ theme }) => theme.colors.primary600};
  }
  &&[data-state='active'] > span:first-of-type {
    font-weight: 600;
  }
`

const SiteSelect = styled.select`
  box-sizing: border-box;
  height: 4rem;
  padding: 0 1.2rem;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral0};
  color: ${({ theme }) => theme.colors.neutral800};
  font: inherit;
  font-size: 1.4rem;
`

const TAB_KINDS: ThemeCardKind[] = ['installed', 'registry', 'update']

/**
 * The Themes page (issues #59 and #288): for one site, the themes its frontend holds, those of the
 * registry and the updates, in three tabs, each card with its admission report; the way to the theme
 * preview, where a theme is activated, and to the Customize page; revert.
 *
 * @remarks
 * Everything comes from `GET /micelio/themes`, which reads the frontend on the server: the admin
 * never calls the frontend or the registry (decision D1 of 2026-11-25).
 */
export default function ThemesPage() {
  const { t } = useMessages()
  return (
    <Page.Protect permissions={[THEMES_MANAGE_PERMISSION]}>
      <Page.Main>
        <Page.Title>{t('themes.title')}</Page.Title>
        <ThemesContent />
      </Page.Main>
    </Page.Protect>
  )
}

function ThemesContent() {
  const { t, rich } = useMessages()
  const [searchParams, setSearchParams] = useSearchParams()
  const chosen = searchParams.get('site')
  const { state, reload, refresh } = useThemes(chosen)
  const data = state.kind === 'ready' ? state.data : undefined
  const { change, revert } = useThemeChange(data?.site.slug ?? chosen ?? '', data?.status, refresh)

  if (state.kind === 'loading') {
    return (
      <>
        <Layouts.Header title={t('themes.title')} />
        <Page.Loading>{t('themes.loading')}</Page.Loading>
      </>
    )
  }
  if (state.kind === 'error' || !data) {
    return (
      <>
        <Layouts.Header title={t('themes.title')} />
        <Layouts.Content>
          <Flex direction="column" alignItems="flex-start" gap={2}>
            <Typography textColor="neutral600">{t('themes.error')}</Typography>
            <Button variant="secondary" size="S" onClick={reload}>
              {t('status.retry')}
            </Button>
          </Flex>
        </Layouts.Content>
      </>
    )
  }

  const { site, status, catalogue } = data
  const isBusy = change.kind === 'sending' || change.kind === 'waiting'
  const cards = themeCards(catalogue, status)
  const linksOf = (card: ThemeCardModel) => ({
    preview: `/plugins/${PLUGIN_ID}/themes/preview?${new URLSearchParams({
      site: site.slug,
      theme: card.theme.id,
      ...(card.theme.version ? { version: card.theme.version } : {}),
    })}`,
    customize: `/plugins/${PLUGIN_ID}/customize?${new URLSearchParams({ site: site.slug })}`,
  })
  const tabTitle: Record<ThemeCardKind, string> = {
    installed: t('themes.installed', { count: cards.installed.length }),
    registry: t('themes.registry', { count: cards.registry.length }),
    update: t('themes.updates', { count: cards.update.length }),
  }
  const empty: Record<ThemeCardKind, string> = {
    installed: t('themes.installed.none'),
    registry:
      catalogue && catalogue.registry === null
        ? t('themes.registry.none', { reason: catalogue.reason ?? '—' })
        : t('themes.registry.empty'),
    update: t('themes.updates.none'),
  }

  return (
    <>
      <Layouts.Header
        title={t('themes.title')}
        subtitle={
          <Typography variant="epsilon" textColor="neutral600" tag="p">
            {status
              ? rich('themes.subtitle', {
                  site: site.name,
                  theme: themeLabel(status.active),
                  b: (chunks) => <strong>{chunks}</strong>,
                })
              : t('themes.subtitle.unknown')}
          </Typography>
        }
        primaryAction={
          <Flex gap={2} alignItems="center">
            <Typography variant="pi" fontWeight="semiBold" tag="label" htmlFor="themes-site">
              {t('themes.site')}
            </Typography>
            <SiteSelect
              id="themes-site"
              value={site.slug}
              onChange={(event) => setSearchParams({ site: event.target.value })}
            >
              {data.sites.map(({ slug, name }) => (
                <option key={slug} value={slug}>
                  {name}
                </option>
              ))}
            </SiteSelect>
          </Flex>
        }
      />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch">
          <Notices
            data={data}
            change={change}
            isBusy={isBusy}
            onRevert={() => void revert()}
            onRetry={reload}
          />
          <Tabs.Root defaultValue="installed" variant="simple">
            <TabList aria-label={t('themes.tabs')}>
              {TAB_KINDS.map((kind) => (
                <Tab key={kind} value={kind}>
                  {tabTitle[kind]}
                </Tab>
              ))}
            </TabList>
            {TAB_KINDS.map((kind) => (
              <Tabs.Content key={kind} value={kind}>
                <Flex direction="column" alignItems="stretch" gap={4} paddingTop={6}>
                  {kind === 'registry' && catalogue?.registry ? (
                    <Typography tag="p" variant="pi" textColor="neutral600">
                      {t('themes.registry.note')}
                    </Typography>
                  ) : null}
                  {cards[kind].length === 0 ? (
                    <Typography textColor="neutral600">{empty[kind]}</Typography>
                  ) : (
                    <Cards>
                      {cards[kind].map((card) => (
                        <ThemeCard
                          key={`${card.theme.id}@${card.theme.version ?? ''}`}
                          card={card}
                          isActive={card.kind === 'installed' && isActive(card.theme, status)}
                          rebuild={needsRebuild({ ...card.theme, code: card.code }, status)}
                          site={site.name}
                          links={linksOf(card)}
                        />
                      ))}
                    </Cards>
                  )}
                </Flex>
              </Tabs.Content>
            ))}
          </Tabs.Root>
          <Box paddingTop={6}>
            <Typography tag="p" variant="pi" textColor="neutral600">
              {t('themes.footer')}
            </Typography>
          </Box>
        </Flex>
      </Layouts.Content>
    </>
  )
}

/**
 * What the artboard does not draw, above the tabs: a site that is not the default, a frontend that
 * does not answer or did not switch, the activation or revert under way, and the revert bar.
 */
function Notices(props: {
  data: ThemesAnswer
  change: ThemeChange
  isBusy: boolean
  onRevert: () => void
  onRetry: () => void
}) {
  const { t } = useMessages()
  const { site, status } = props.data
  return (
    <Box>
      {site.isDefault ? null : (
        <Notice role="status" text={t('themes.notDefault', { site: site.name })} />
      )}
      {status ? null : (
        <Notice
          role="alert"
          title={t('themes.frontend.title')}
          text={
            site.origin
              ? t('themes.frontend.body', { origin: site.origin })
              : t('themes.frontend.noUrl', { site: site.name })
          }
        >
          <Button variant="secondary" size="S" onClick={props.onRetry}>
            {t('status.retry')}
          </Button>
        </Notice>
      )}
      {status?.error ? (
        <Notice
          role="status"
          title={t('themes.switchError.title')}
          text={t('themes.switchError.body', {
            theme: status.error.requested ? themeLabel(status.error.requested) : '—',
            message: status.error.message,
          })}
        />
      ) : null}
      <ThemeChangeNotice change={props.change} origin={site.origin} />
      <RevertBar data={props.data} isBusy={props.isBusy} onRevert={props.onRevert} />
    </Box>
  )
}

function RevertBar(props: { data: ThemesAnswer; isBusy: boolean; onRevert: () => void }) {
  const { t } = useMessages()
  const { revert, site } = props.data
  if (!revert) return null
  const previous = themeOfPin(revert.pin)
  const name = previous ? themeLabel(previous) : t('themes.default')
  return (
    <Box padding={3} marginBottom={2} background="neutral100" hasRadius>
      <Flex gap={3} alignItems="center" wrap="wrap">
        <Typography>{t('themes.revert.text', { theme: name, site: site.name })}</Typography>
        {revert.isInstalled ? (
          <Button variant="secondary" size="S" disabled={props.isBusy} onClick={props.onRevert}>
            {t('themes.revert', { theme: name })}
          </Button>
        ) : (
          <Typography textColor="neutral600">{t('themes.revert.gone', { theme: name })}</Typography>
        )}
      </Flex>
    </Box>
  )
}
