import { Box, Button, Dialog, Flex, LinkButton, Typography } from '@strapi/design-system'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import styled from 'styled-components'

import type { CatalogueReport } from '../../../server/src/types/themes'
import { useMessages } from '../messages'
import {
  admissionPasses,
  layoutVariants,
  manualCheckDate,
  modeNames,
  themeLabel,
  versionChange,
  type ThemeCardModel,
} from '../utils/themes'

type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'secondary' | 'alternative'

// The active theme's card has a border in the success colour; the others keep the same space.
const CardBox = styled(Box)<{ $isActive: boolean }>`
  border: 2px solid
    ${({ $isActive, theme }) => ($isActive ? theme.colors.success600 : 'transparent')};
`

// The artboard's chips and badges: the Design System's colours, in its sentence case (its `Badge`
// sets the text in capitals). A warning's text is `neutral800`: `warning700` on `warning100` is
// 4.0:1, under the 4.5:1 of WCAG AA.
const Tag = styled.span<{ $tone: Tone; $size: 'chip' | 'badge' }>`
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.2rem 0.8rem;
  border-radius: ${({ theme }) => theme.borderRadius};
  font-size: ${({ $size }) => ($size === 'chip' ? '1.1rem' : '1.2rem')};
  line-height: 1.5;
  white-space: nowrap;
  ${({ $tone, theme }) =>
    $tone === 'neutral'
      ? `background: ${theme.colors.neutral100};
         border: 1px solid ${theme.colors.neutral200};
         color: ${theme.colors.neutral800};`
      : `background: ${theme.colors[`${$tone}100`]};
         color: ${$tone === 'warning' ? theme.colors.neutral800 : theme.colors[`${$tone}700`]};`}
  font-weight: ${({ $tone, $size }) => ($tone === 'neutral' && $size === 'chip' ? 400 : 600)};
`

const Dot = styled.span`
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.success600};
`

// The summary is the report's Markdown, shown as written: the page renders no Markdown.
const Summary = styled.pre`
  margin: 0;
  text-align: start;
  white-space: pre-wrap;
  font: inherit;
`

/** Where a card's buttons go: the paths of the pages they open. */
export interface ThemeCardLinks {
  /** The theme preview of a version. */
  preview: string
  /** The Customize page of the site. */
  customize: string
}

/**
 * One card of the Themes page (issue #288): the theme's name and meta line with its badge, its chips
 * (modes, variants, admission, accessibility, rebuild), the note of a registry code theme the image
 * was not built with or of an update, and its buttons. Nothing activates here: a theme is activated
 * from its preview.
 */
export function ThemeCard(props: {
  card: ThemeCardModel
  isActive: boolean
  rebuild: boolean
  site: string
  links: ThemeCardLinks
}) {
  const { t } = useMessages()
  const { card, isActive, rebuild, site, links } = props
  const label = themeLabel(card.theme)
  const isUpdate = card.kind === 'update'
  const meta = isUpdate
    ? [
        t('themes.update.from', { from: card.from ?? '' }),
        t(`themes.bump.${versionChange(card.from ?? '', card.theme.version ?? '')}`),
        card.contract ? t('themes.contract', { contract: card.contract }) : '',
      ]
    : [
        label,
        card.contract ? t('themes.contract', { contract: card.contract }) : '',
        t(card.code ? 'themes.kind.code' : 'themes.kind.data'),
        card.license ?? '',
      ]
  return (
    <CardBox
      tag="article"
      aria-label={label}
      data-theme-card={card.theme.id}
      background="neutral0"
      paddingTop={4}
      paddingBottom={4}
      paddingLeft={5}
      paddingRight={5}
      hasRadius
      shadow="tableShadow"
      $isActive={isActive}
    >
      <Flex direction="column" alignItems="stretch" gap="1rem">
        <Flex justifyContent="space-between" alignItems="center" gap={2}>
          <Flex direction="column" alignItems="flex-start">
            <Typography variant="delta" tag="h3" fontWeight="semiBold">
              {isUpdate ? `${card.name} ${card.theme.version ?? ''}` : card.name}
            </Typography>
            <Typography variant="pi" textColor="neutral600">
              {meta.filter(Boolean).join(' · ')}
            </Typography>
          </Flex>
          <CardBadge card={card} isActive={isActive} />
        </Flex>
        {isUpdate ? null : <Chips card={card} rebuild={rebuild} />}
        {card.kind === 'registry' && rebuild ? (
          <Typography tag="p" variant="pi" textColor="neutral600">
            {t('themes.registry.code')}
          </Typography>
        ) : null}
        {isUpdate ? (
          <Typography tag="p" variant="pi" textColor="neutral600">
            {t('themes.update.body', { from: card.from ?? '', version: card.theme.version ?? '' })}
          </Typography>
        ) : null}
        <Flex gap={2} wrap="wrap">
          {isActive ? (
            <LinkButton tag={NavLink} to={links.customize} variant="tertiary" size="M">
              {t('themes.customize')}
            </LinkButton>
          ) : (
            <PreviewLink card={card} site={site} to={links.preview} />
          )}
          {card.kind === 'installed' && card.report ? (
            <ReportDialog report={card.report} theme={label} />
          ) : null}
        </Flex>
      </Flex>
    </CardBox>
  )
}

function CardBadge({ card, isActive }: { card: ThemeCardModel; isActive: boolean }) {
  const { t } = useMessages()
  if (isActive) {
    return (
      <Tag $tone="success" $size="badge" data-badge="active">
        <Dot aria-hidden="true" />
        {t('themes.badge.active')}
      </Tag>
    )
  }
  if (card.kind === 'registry') {
    return (
      <Tag $tone="alternative" $size="badge">
        {t('themes.badge.registry', { tier: card.tier ?? '' })}
      </Tag>
    )
  }
  if (card.kind === 'update') {
    return (
      <Tag $tone="secondary" $size="badge">
        {t('themes.badge.update')}
      </Tag>
    )
  }
  return (
    <Tag $tone="neutral" $size="badge">
      {t('themes.badge.installed')}
    </Tag>
  )
}

function Chips({ card, rebuild }: { card: ThemeCardModel; rebuild: boolean }) {
  const { t } = useMessages()
  const chips: { key: string; tone: Tone; text: string }[] = []
  if (card.modes?.length) {
    chips.push({ key: 'modes', tone: 'neutral', text: modeNames(card.modes).join(' · ') })
  }
  if (card.layout) {
    chips.push({ key: 'layout', tone: 'neutral', text: layoutVariants(card.layout).join(' · ') })
  }
  if (!card.report) {
    chips.push({ key: 'admission', tone: 'neutral', text: t('themes.report.none') })
  } else if (!card.report.ok) {
    chips.push({ key: 'admission', tone: 'danger', text: t('themes.report.failed') })
  } else {
    const { aa, budgets } = admissionPasses(card.report)
    const text = [
      t('themes.report.ok'),
      aa ? t('themes.report.aa') : '',
      budgets ? t('themes.report.budgets') : '',
    ]
    chips.push({ key: 'admission', tone: 'success', text: text.filter(Boolean).join(' · ') })
  }
  const checked = manualCheckDate(card.report)
  if (checked !== null) {
    chips.push({
      key: 'a11y',
      tone: 'success',
      text: checked ? t('themes.a11y', { date: checked }) : t('themes.a11y.undated'),
    })
  }
  if (!card.code) chips.push({ key: 'rebuild', tone: 'secondary', text: t('themes.noRebuild') })
  else if (rebuild) chips.push({ key: 'rebuild', tone: 'warning', text: t('themes.needsImage') })
  if (!card.runs) chips.push({ key: 'runs', tone: 'neutral', text: t('themes.runs.not') })
  return (
    <Flex gap="0.6rem" wrap="wrap">
      {chips.map(({ key, tone, text }) => (
        <Tag key={key} $tone={tone} $size="chip" data-chip={key}>
          {text}
        </Tag>
      ))}
    </Flex>
  )
}

function PreviewLink(props: { card: ThemeCardModel; site: string; to: string }) {
  const { t } = useMessages()
  const { card, site, to } = props
  const theme = themeLabel(card.theme)
  const isUpdate = card.kind === 'update'
  return (
    <LinkButton
      tag={NavLink}
      to={to}
      variant={card.kind === 'registry' ? 'tertiary' : 'default'}
      size="M"
      aria-label={
        isUpdate
          ? t('themes.preview.update.label', { theme })
          : t('themes.preview.label', { theme, site })
      }
    >
      {isUpdate ? t('themes.preview.update') : t('themes.preview', { site })}
    </LinkButton>
  )
}

/** The Admission report button and the dialog with the report's summary that it opens. */
function ReportDialog({ report, theme }: { report: CatalogueReport; theme: string }): ReactNode {
  const { t } = useMessages()
  return (
    <Dialog.Root>
      <Dialog.Trigger>
        <Button variant="tertiary" size="M" aria-label={t('themes.report.label', { theme })}>
          {t('themes.report.open')}
        </Button>
      </Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Header>{t('themes.report.title', { theme })}</Dialog.Header>
        <Dialog.Body>
          <Typography textColor="neutral700">
            <Summary>{report.summary || t('themes.report.empty')}</Summary>
          </Typography>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Cancel>
            <Button variant="tertiary" fullWidth>
              {t('themes.report.close')}
            </Button>
          </Dialog.Cancel>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}
