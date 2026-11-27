import { Badge, Box, Button, Flex, LinkButton, Typography } from '@strapi/design-system'
import { Layouts, Page } from '@strapi/strapi/admin'
import type { ReactNode } from 'react'
import { NavLink, useSearchParams } from 'react-router-dom'
import styled from 'styled-components'

import type {
  CatalogueReport,
  FrontendThemeStatus,
  ThemesAnswer,
} from '../../../server/src/types/themes'
import { AdmissionReport } from '../components/AdmissionReport'
import { Notice } from '../components/Notice'
import { ThemeChangeNotice } from '../components/ThemeChangeNotice'
import { useThemeChange } from '../hooks/useThemeChange'
import { useThemes } from '../hooks/useThemes'
import { useMessages } from '../messages'
import { THEMES_MANAGE_PERMISSION } from '../permissions'
import { PLUGIN_ID } from '../pluginId'
import {
  isActive,
  needsRebuild,
  reportOf,
  themeLabel,
  themeOfPin,
  type ThemeRef,
} from '../utils/themes'

// Two cards a row, as the artboard lays them out; one on a narrow screen.
const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${({ theme }) => theme.spaces[4]};
  align-items: start;
  @media (max-width: 62rem) {
    grid-template-columns: minmax(0, 1fr);
  }
`

// The active theme's card has a border in the success colour; the others keep the same space.
const CardBox = styled(Box)<{ $isActive: boolean }>`
  border: 2px solid
    ${({ $isActive, theme }) => ($isActive ? theme.colors.success600 : 'transparent')};
`

/** A theme as one card of the page lists it. */
interface ThemeCard {
  theme: ThemeRef
  code: boolean
  /** The second line: contract, kind, store, tier. */
  details: string
  /** The badge beside the name, unless it is the active theme. */
  badge: string
  report: CatalogueReport | undefined
  /** A version the registry says does not run on this core; it cannot be activated. */
  isIncompatible?: boolean
}

/**
 * The Themes page (issue #59): for one site, the themes its frontend holds, those of the registry and
 * the updates, each with its admission report; activate, revert, and the way to the theme preview.
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
  const { t } = useMessages()
  const [searchParams, setSearchParams] = useSearchParams()
  const chosen = searchParams.get('site')
  const { state, reload, refresh } = useThemes(chosen)
  const data = state.kind === 'ready' ? state.data : undefined
  const { change, activate, revert } = useThemeChange(
    data?.site.slug ?? chosen ?? '',
    data?.status,
    refresh
  )

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
  const previewPath = (theme: ThemeRef) =>
    `/plugins/${PLUGIN_ID}/themes/preview?${new URLSearchParams({
      site: site.slug,
      theme: theme.id,
      ...(theme.version ? { version: theme.version } : {}),
    })}`

  const actionsOf = (card: ThemeCard): ReactNode => {
    if (isActive(card.theme, status)) return null
    const rebuild = needsRebuild({ ...card.theme, code: card.code }, status)
    return (
      <Flex gap={2} wrap="wrap" alignItems="center">
        <LinkButton
          tag={NavLink}
          to={previewPath(card.theme)}
          variant="secondary"
          size="S"
          aria-label={t('themes.preview.label', { theme: themeLabel(card.theme), site: site.name })}
        >
          {t('themes.preview', { site: site.name })}
        </LinkButton>
        {rebuild ? null : (
          <Button
            size="S"
            disabled={isBusy || !status || card.isIncompatible}
            onClick={() => void activate(card.theme)}
            aria-label={t('themes.activate.label', {
              theme: themeLabel(card.theme),
              site: site.name,
            })}
          >
            {t('themes.activate')}
          </Button>
        )}
      </Flex>
    )
  }

  // The active theme first, as the artboard lists it.
  const installedThemes = [...(catalogue?.installed ?? [])].sort(
    (a, b) => Number(isActive(b, status)) - Number(isActive(a, status))
  )
  const installed: ThemeCard[] = installedThemes.map((theme) => ({
    theme: { id: theme.id, version: theme.version },
    code: theme.code,
    details: [
      t('themes.contract', { contract: theme.contract }),
      t(theme.code ? 'themes.kind.code' : 'themes.kind.data'),
      t(`themes.store.${theme.store}`),
    ].join(' · '),
    badge: t('themes.badge.installed'),
    report: reportOf(theme.report, catalogue),
  }))
  const registry: ThemeCard[] = (catalogue?.registry ?? []).flatMap(({ id, versions }) => {
    const newest = versions.find(({ status: state }) => state === 'published') ?? versions[0]
    if (!newest) return []
    return [
      {
        theme: { id, version: newest.version },
        code: newest.code,
        details: [
          t('themes.contract', { contract: newest.contract }),
          t(newest.code ? 'themes.kind.code' : 'themes.kind.data'),
          newest.license,
          t(newest.runs ? 'themes.runs' : 'themes.runs.not'),
        ]
          .filter(Boolean)
          .join(' · '),
        badge: t('themes.badge.registry', { tier: newest.tier }),
        report: reportOf(newest.report, catalogue),
        isIncompatible: !newest.runs,
      },
    ]
  })

  return (
    <>
      <Layouts.Header
        title={t('themes.title')}
        subtitle={
          status
            ? t('themes.subtitle', { site: site.name, theme: themeLabel(status.active) })
            : t('themes.subtitle.unknown')
        }
      />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={6}>
          <Flex direction="column" alignItems="flex-start" gap={1}>
            <label htmlFor="themes-site">
              <Typography variant="sigma" textColor="neutral600" tag="span">
                {t('themes.site')}
              </Typography>
            </label>
            <select
              id="themes-site"
              value={site.slug}
              onChange={(event) => setSearchParams({ site: event.target.value })}
              style={{ padding: 8, minWidth: 240 }}
            >
              {data.sites.map(({ slug, name }) => (
                <option key={slug} value={slug}>
                  {name} ({slug})
                </option>
              ))}
            </select>
          </Flex>
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
                <Button variant="secondary" size="S" onClick={reload}>
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
            <ThemeChangeNotice change={change} origin={site.origin} />
            <RevertBar data={data} isBusy={isBusy} onRevert={() => void revert()} />
          </Box>
          <Section title={t('themes.installed', { count: installed.length })}>
            {installed.length === 0 ? (
              <Typography textColor="neutral600">{t('themes.installed.none')}</Typography>
            ) : (
              installed.map((card) => (
                <Card
                  key={`${card.theme.id}@${card.theme.version}`}
                  card={card}
                  status={status}
                  actions={actionsOf(card)}
                />
              ))
            )}
          </Section>
          <Section title={t('themes.registry', { count: registry.length })}>
            {catalogue && catalogue.registry === null ? (
              <Typography textColor="neutral600">
                {t('themes.registry.none', { reason: catalogue.reason ?? '—' })}
              </Typography>
            ) : (
              registry.map((card) => (
                <Card key={card.theme.id} card={card} status={status} actions={actionsOf(card)} />
              ))
            )}
          </Section>
          <Section title={t('themes.updates', { count: catalogue?.updates.length ?? 0 })}>
            {(catalogue?.updates ?? []).length === 0 ? (
              <Typography textColor="neutral600">{t('themes.updates.none')}</Typography>
            ) : (
              catalogue?.updates.map((update) => {
                const card: ThemeCard = {
                  theme: { id: update.id, version: update.version },
                  code:
                    catalogue.registry
                      ?.find(({ id }) => id === update.id)
                      ?.versions.find(({ version }) => version === update.version)?.code ?? false,
                  details: t('themes.update.from', { from: update.from }),
                  badge: t('themes.badge.update'),
                  report: catalogue.reports.find(
                    ({ id, version }) => id === update.id && version === update.version
                  ),
                }
                return (
                  <Card
                    key={`${update.id}@${update.version}`}
                    card={card}
                    status={status}
                    actions={actionsOf(card)}
                  />
                )
              })
            )}
          </Section>
          <Typography tag="p" textColor="neutral600">
            {t('themes.footer')}
          </Typography>
        </Flex>
      </Layouts.Content>
    </>
  )
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <Flex tag="section" direction="column" alignItems="stretch" gap={3}>
      <Typography variant="delta" tag="h2">
        {props.title}
      </Typography>
      <Cards>{props.children}</Cards>
    </Flex>
  )
}

function Card(props: { card: ThemeCard; status: FrontendThemeStatus | null; actions: ReactNode }) {
  const { t } = useMessages()
  const { card, status } = props
  const isOn = isActive(card.theme, status)
  const rebuild = needsRebuild({ ...card.theme, code: card.code }, status)
  return (
    <CardBox
      tag="article"
      aria-label={themeLabel(card.theme)}
      data-theme-card={card.theme.id}
      background="neutral0"
      padding={5}
      hasRadius
      shadow="tableShadow"
      $isActive={isOn}
    >
      <Flex direction="column" alignItems="stretch" gap={2}>
        <Flex gap={2} alignItems="center" wrap="wrap">
          <Typography variant="delta" tag="h3">
            {themeLabel(card.theme)}
          </Typography>
          {isOn ? (
            <Badge backgroundColor="success100" textColor="success700">
              {t('themes.badge.active')}
            </Badge>
          ) : (
            <Badge>{card.badge}</Badge>
          )}
        </Flex>
        <Typography textColor="neutral600">{card.details}</Typography>
        <Typography fontWeight="semiBold">
          {card.report
            ? t(card.report.ok ? 'themes.report.ok' : 'themes.report.failed')
            : t('themes.report.none')}
          {' · '}
          {t(
            card.code && !rebuild
              ? 'themes.builtWith'
              : card.code
                ? 'themes.needsImage'
                : 'themes.noRebuild'
          )}
        </Typography>
        {card.report ? <AdmissionReport report={card.report} /> : null}
        {rebuild ? (
          <Notice
            role="status"
            title={t('themes.rebuild.title')}
            text={t('themes.rebuild.body', { theme: themeLabel(card.theme) })}
          />
        ) : null}
        {props.actions}
      </Flex>
    </CardBox>
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
