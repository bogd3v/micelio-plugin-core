import { Box, Button, Flex, Link, Typography } from '@strapi/design-system'
import { Layouts, Page } from '@strapi/strapi/admin'
import { useEffect, useRef, useState } from 'react'
import { NavLink, useSearchParams } from 'react-router-dom'
import styled from 'styled-components'

import type { PreviewThemeOverride } from '../../../server/src/types/preview'
import type { ThemePreviewPage as PreviewablePage } from '../../../server/src/types/themes'
import { AdmissionReport } from '../components/AdmissionReport'
import { Notice } from '../components/Notice'
import { ThemeChangeNotice } from '../components/ThemeChangeNotice'
import { PreviewFrame, type FrameState } from '../components/PreviewFrame'
import { useLoaded } from '../hooks/useAsync'
import { usePreviewSource } from '../hooks/usePreviewSource'
import { useThemeChange } from '../hooks/useThemeChange'
import { useThemes } from '../hooks/useThemes'
import { useMessages } from '../messages'
import { THEMES_MANAGE_PERMISSION } from '../permissions'
import { PLUGIN_ID } from '../pluginId'
import type { PreviewMode } from '../utils/previewPane'
import {
  isActive,
  isInstalled,
  needsRebuild,
  reportOf,
  themeLabel,
  type ThemeRef,
} from '../utils/themes'

// The widest each frame lays the page out at; a frame never grows past its column.
const FRAME_WIDTH = 1280

const Columns = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
  @media (max-width: 62rem) {
    grid-template-columns: minmax(0, 1fr);
  }
`

// The comparison and, beside it, the checks (the artboard's side column).
const Body = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 20rem;
  gap: 1.5rem;
  align-items: start;
  @media (max-width: 75rem) {
    grid-template-columns: minmax(0, 1fr);
  }
`

// The candidate's frame is outlined in the primary colour, as the artboard draws it.
const StageBox = styled.div<{ $isCandidate?: boolean }>`
  border-radius: 4px;
  outline: ${({ $isCandidate, theme }) =>
    $isCandidate ? `2px solid ${theme.colors.primary600}` : 'none'};
  outline-offset: 2px;
  position: relative;
  height: calc(100vh - 24rem);
  min-height: 28rem;
`

const Select = styled.select`
  min-height: 2rem;
  padding: 0 0.5rem;
  border: 1px solid #8e8ea9;
  border-radius: 4px;
  background: #ffffff;
  color: #32324d;
  font: inherit;
`

/**
 * The theme preview (issue #59): a page of the site in its active theme and in a candidate, side by
 * side, each frame with a token of its own; the candidate's token carries the theme (ADR-0019 of
 * `micelio`, amendment of 2026-11-25), never its URL. Opened from the Themes page with `?site=`,
 * `?theme=` and `?version=`.
 */
export default function ThemePreviewPage() {
  const { t } = useMessages()
  return (
    <Page.Protect permissions={[THEMES_MANAGE_PERMISSION]}>
      <Page.Main>
        <Page.Title>{t('themePreview.title')}</Page.Title>
        <ThemePreviewContent />
      </Page.Main>
    </Page.Protect>
  )
}

function ThemePreviewContent() {
  const { t } = useMessages()
  const [searchParams] = useSearchParams()
  const slug = searchParams.get('site')
  const candidate: ThemeRef = {
    id: searchParams.get('theme') ?? '',
    ...(searchParams.get('version') ? { version: searchParams.get('version') ?? '' } : {}),
  }
  const { state, reload, refresh } = useThemes(slug)
  const data = state.kind === 'ready' ? state.data : undefined
  const pageTypes = useLoaded<{ id: string }[]>(
    data ? `/micelio/budget/page-types?site=${encodeURIComponent(data.site.slug)}` : null
  )
  const [pageType, setPageType] = useState<string | null>(null)
  const [mode, setMode] = useState<PreviewMode>('live')
  // The page and mode the current theme's frame has loaded: the candidate's asks for its token after it.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const { change, activate } = useThemeChange(data?.site.slug ?? slug ?? '', data?.status, refresh)
  const backPath = `/plugins/${PLUGIN_ID}/themes${slug ? `?site=${encodeURIComponent(slug)}` : ''}`

  if (state.kind === 'loading') {
    return (
      <>
        <Layouts.Header title={t('themePreview.title')} />
        <Page.Loading>{t('themes.loading')}</Page.Loading>
      </>
    )
  }
  if (state.kind === 'error' || !data) {
    return (
      <>
        <Layouts.Header title={t('themePreview.title')} />
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

  const { site, status, catalogue, pages } = data
  // The page types the budgets name, and `standard` for a page that has none: those with a page here first.
  const types = [
    ...new Set([
      ...pages.map((page) => page.pageType),
      ...(pageTypes.resource.kind === 'ready' ? pageTypes.resource.data.map(({ id }) => id) : []),
    ]),
  ]
  const chosenType = pageType ?? pages[0]?.pageType ?? types[0] ?? null
  const page = pages.find((each) => each.pageType === chosenType)
  const installed = isInstalled(candidate, catalogue)
  const candidateVersion =
    candidate.version ??
    catalogue?.installed.find(({ id }) => id === candidate.id)?.version ??
    status?.available.builtIn.find(({ id }) => id === candidate.id)?.version
  const override: PreviewThemeOverride | undefined =
    installed && candidateVersion ? { id: candidate.id, version: candidateVersion } : undefined
  const listed =
    catalogue?.installed.find(
      ({ id, version }) => id === candidate.id && version === candidateVersion
    ) ??
    catalogue?.registry
      ?.find(({ id }) => id === candidate.id)
      ?.versions.find(({ version }) => version === candidateVersion)
  const code = listed?.code ?? false
  const report = reportOf(listed?.report, catalogue)
  const rebuild = needsRebuild({ ...candidate, code }, status)
  const isBusy = change.kind === 'sending' || change.kind === 'waiting'
  const candidateRef = {
    id: candidate.id,
    ...(candidateVersion ? { version: candidateVersion } : {}),
  }
  const loadKey = page ? `${page.uid}:${page.documentId}:${page.locale ?? ''}:${mode}` : ''

  return (
    <>
      <Layouts.Header
        title={t('themePreview.heading', { theme: themeLabel(candidateRef), site: site.name })}
        subtitle={t('themePreview.subtitle')}
        navigationAction={
          <Link tag={NavLink} to={backPath}>
            {t('themePreview.back')}
          </Link>
        }
        primaryAction={
          rebuild || isActive(candidateRef, status) ? undefined : (
            <Button disabled={isBusy || !status} onClick={() => void activate(candidateRef)}>
              {t('themePreview.activate', { site: site.name })}
            </Button>
          )
        }
      />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={4}>
          <Flex gap={4} alignItems="center" wrap="wrap">
            <Flex tag="label" gap={2} alignItems="center">
              <Typography>{t('themePreview.pageType')}</Typography>
              <Select
                value={chosenType ?? ''}
                onChange={(event) => setPageType(event.target.value)}
              >
                {types.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Flex>
            <Flex tag="label" gap={2} alignItems="center">
              <input
                type="checkbox"
                checked={mode === 'static'}
                onChange={(event) => setMode(event.target.checked ? 'static' : 'live')}
              />
              <Typography>{t('preview.static')}</Typography>
            </Flex>
          </Flex>
          <Box>
            {site.isDefault ? null : (
              <Notice role="status" text={t('themes.notDefault', { site: site.name })} />
            )}
            {rebuild ? (
              <Notice
                role="status"
                title={t('themes.rebuild.title')}
                text={t('themePreview.rebuild', { theme: themeLabel(candidateRef) })}
              />
            ) : null}
            <ThemeChangeNotice change={change} origin={site.origin} />
          </Box>
          <Body>
            {page ? (
              <Columns>
                <ThemeFrame
                  label={t('themePreview.current', {
                    theme: status ? themeLabel(status.active) : '—',
                  })}
                  page={page}
                  mode={mode}
                  onLoaded={() => setLoadedKey(loadKey)}
                />
                {override ? (
                  <ThemeFrame
                    label={t('themePreview.candidate', { theme: themeLabel(candidateRef) })}
                    page={page}
                    mode={mode}
                    theme={override}
                    isWaiting={loadedKey !== loadKey}
                    isCandidate
                  />
                ) : (
                  <Flex direction="column" alignItems="stretch" gap={2}>
                    <Typography variant="sigma" tag="h2" textColor="primary600">
                      {t('themePreview.candidate', { theme: themeLabel(candidateRef) })}
                    </Typography>
                    <Notice
                      role="alert"
                      title={t('themePreview.notInstalled.title')}
                      text={t('themePreview.notInstalled', { theme: themeLabel(candidateRef) })}
                    />
                  </Flex>
                )}
              </Columns>
            ) : (
              <Typography textColor="neutral600">
                {t('themePreview.noPage', { type: chosenType ?? '—', site: site.name })}
              </Typography>
            )}
            <Box tag="aside" padding={4} background="neutral0" hasRadius shadow="tableShadow">
              <Typography variant="delta" tag="h2">
                {t('themePreview.checks')}
              </Typography>
              <Typography tag="p">
                {report
                  ? t(report.ok ? 'themes.report.ok' : 'themes.report.failed')
                  : t('themes.report.none')}
              </Typography>
              {report ? <AdmissionReport report={report} /> : null}
              <Typography tag="p" textColor="neutral600">
                {t('themePreview.checks.note')}
              </Typography>
              <Box
                paddingTop={4}
                marginTop={4}
                borderColor="neutral150"
                borderStyle="solid"
                borderWidth="1px 0 0 0"
              >
                <Typography tag="p" textColor="neutral600">
                  {t('themePreview.recorded')}
                </Typography>
              </Box>
            </Box>
          </Body>
        </Flex>
      </Layouts.Content>
    </>
  )
}

/**
 * One frame of the comparison: the page, with its own token, in the site's theme or in `theme`.
 *
 * @remarks
 * The frontend keeps one preview grant per browser, in one cookie of its origin, so two frames that
 * exchange their tokens at once can each render with the other's grant. The candidate's frame waits
 * (`isWaiting`) until the current one has loaded (`onLoaded`: its `ready`, or no answer, a refusal or a
 * frame the admin's CSP blocks), and asks for its token then. Neither asks for a new token before
 * its grant expires: a frame loads again only when the page type or the mode changes.
 */
function ThemeFrame(props: {
  label: string
  page: PreviewablePage
  mode: PreviewMode
  theme?: PreviewThemeOverride
  onLoaded?: () => void
  isWaiting?: boolean
  /** The candidate's frame: its label and outline in the primary colour. */
  isCandidate?: boolean
}) {
  const { t } = useMessages()
  const { page, mode, theme, isWaiting } = props
  const { source } = usePreviewSource(
    isWaiting ? undefined : { uid: page.uid, documentId: page.documentId, locale: page.locale },
    mode,
    theme,
    // No new token on a timer: each frame would load again on its own, in no fixed order.
    { refreshGrant: false }
  )
  const [isBlocked, setIsBlocked] = useState(false)
  const [frameState, setFrameState] = useState<FrameState | undefined>()
  const onLoadedRef = useRef(props.onLoaded)
  onLoadedRef.current = props.onLoaded
  useEffect(() => {
    if (source.kind === 'error' || isBlocked || frameState?.isSilent) onLoadedRef.current?.()
  }, [source.kind, isBlocked, frameState?.isSilent])
  return (
    <Flex tag="section" direction="column" alignItems="stretch" gap={2} aria-label={props.label}>
      <Typography
        variant="sigma"
        tag="h2"
        textColor={props.isCandidate ? 'primary600' : 'neutral800'}
      >
        {props.label}
      </Typography>
      {source.kind === 'error' ? (
        <Notice role="alert" text={t(`preview.error.${source.reason}`)} />
      ) : null}
      {isBlocked ? (
        <Notice
          role="alert"
          title={t('preview.blocked.title')}
          text={t('preview.blocked.body', {
            origin: source.kind === 'ready' ? source.origin : '',
          })}
        />
      ) : null}
      {frameState?.isSilent ? <Notice role="status" text={t('themePreview.silent')} /> : null}
      {isWaiting && source.kind === 'loading' ? (
        <Typography role="status" textColor="neutral600">
          {t('themePreview.waiting')}
        </Typography>
      ) : null}
      <StageBox $isCandidate={props.isCandidate}>
        {isBlocked || source.kind === 'error' ? null : (
          <PreviewFrame
            src={source.kind === 'ready' ? source.src : undefined}
            origin={source.kind === 'ready' ? source.origin : undefined}
            documentId={page.documentId}
            locale={page.locale}
            title={t('themePreview.frame', { title: page.title, theme: props.label })}
            width={FRAME_WIDTH}
            onChange={setFrameState}
            onBlocked={() => setIsBlocked(true)}
            onMessage={(message) => {
              if (message.type === 'ready') onLoadedRef.current?.()
            }}
          />
        )}
      </StageBox>
    </Flex>
  )
}
