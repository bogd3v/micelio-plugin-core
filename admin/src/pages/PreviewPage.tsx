import { Badge, Box, Button, Flex, Link, Typography } from '@strapi/design-system'
import { Layouts, Page, useAuth } from '@strapi/strapi/admin'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { NavLink, useHref, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import styled from 'styled-components'

import { CostMeter } from '../components/CostMeter'
import { PreviewFrame, type FrameState, type PreviewFrameHandle } from '../components/PreviewFrame'
import { useBudget } from '../hooks/useBudget'
import { useEntry, type Entry } from '../hooks/useEntry'
import { useNewTab, usePreviewSource, type PreviewSourceError } from '../hooks/usePreviewSource'
import { useMessages } from '../messages'
import { PREVIEW_PERMISSION } from '../permissions'
import { weightRoute } from '../utils/costMeter'
import { DEVICES, previewShortcut, type DeviceId, type PreviewMode } from '../utils/previewPane'

// The motion tokens of the Motion artboard: fast 120 ms, base 200 ms, slow 320 ms. With
// `prefers-reduced-motion` every transition lasts 1 ms and only the travel disappears.
const Root = styled.div`
  --m-fast: 120ms;
  --m-base: 200ms;
  --m-slow: 320ms;
  @media (prefers-reduced-motion: reduce) {
    --m-fast: 1ms;
    --m-base: 1ms;
    --m-slow: 1ms;
  }
`

const Columns = styled.div`
  display: grid;
  grid-template-columns: minmax(16rem, 1fr) minmax(0, 2fr);
  gap: 1.5rem;
  align-items: start;
  @media (max-width: 62rem) {
    grid-template-columns: minmax(0, 1fr);
  }
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

const StageBox = styled.div`
  position: relative;
  height: calc(100vh - 20rem);
  min-height: 32rem;
`

// Covers the frame while it is silent; the frame stays under it, so a late `ready` takes the cover away.
const Cover = styled.div`
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: #ffffff;
`

const SHORTCUTS = {
  phone: 'Control+Shift+1 Meta+Shift+1',
  tablet: 'Control+Shift+2 Meta+Shift+2',
  desktop: 'Control+Shift+3 Meta+Shift+3',
  static: 'Control+Shift+S Meta+Shift+S',
}

/** The preview of one entry beside the link to its form (issue #45); opened from the entry's edit view. */
export default function PreviewPage() {
  return (
    <Page.Protect permissions={[PREVIEW_PERMISSION]}>
      <PreviewPane />
    </Page.Protect>
  )
}

function PreviewPane() {
  const { t, date } = useMessages()
  const { uid = '', documentId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const permissions = useAuth('PreviewPage', (state) => state.permissions)
  const [locale, setLocale] = useState<string | null>(searchParams.get('locale'))
  const [device, setDevice] = useState<DeviceId>('desktop')
  const [mode, setMode] = useState<PreviewMode>('live')
  const [frameState, setFrameState] = useState<FrameState>({
    protocol: 'waiting',
    versions: [],
    isBusy: false,
    isSilent: false,
  })
  const [isBlocked, setIsBlocked] = useState(false)
  const frame = useRef<PreviewFrameHandle>(null)
  const { resource, savedCount } = useEntry(uid, documentId, locale)
  const entry = resource.kind === 'ready' ? resource.entry : undefined
  const { source, reload } = usePreviewSource(
    entry ? { uid, documentId, locale: entry.locale } : undefined,
    mode
  )
  // The frame holds the editor's grant once it has loaded; the meter reads the weight with it.
  const weightUrl =
    source.kind === 'ready' && frameState.protocol === 'ok'
      ? weightRoute(source.src, uid, documentId, entry ? entry.locale : locale)
      : undefined
  const { resource: budget, measureAgain } = useBudget(
    uid,
    documentId,
    entry ? entry.locale : locale,
    entry?.updatedAt,
    weightUrl
  )
  const newTab = useNewTab(entry ? { uid, documentId, locale: entry.locale } : undefined, mode)
  const canEdit = permissions.some(
    ({ action, subject }) => action === 'plugin::content-manager.explorer.update' && subject === uid
  )
  const entryPath = `/content-manager/collection-types/${uid}/${documentId}${
    entry?.locale ? `?plugins[i18n][locale]=${entry.locale}` : ''
  }`

  // A save: tell the frame to load the draft again; a frame that cannot be told loads it anew.
  // `useEntry` counts again from 0 for each locale, so the count handled is kept per locale.
  const handled = useRef({ locale, count: 0 })
  useEffect(() => {
    if (handled.current.locale !== locale) handled.current = { locale, count: 0 }
    if (savedCount === 0 || savedCount === handled.current.count) return
    handled.current.count = savedCount
    if (!frame.current?.loadDraft()) reload()
  }, [savedCount, locale, reload])

  // A new source is a new frame: the blocked notice belongs to the origin it was raised for.
  const origin = source.kind === 'ready' ? source.origin : undefined
  useEffect(() => setIsBlocked(false), [origin])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const shortcut = previewShortcut(event)
      if (!shortcut) return
      event.preventDefault()
      if (shortcut.action === 'device') setDevice(shortcut.device)
      else if (shortcut.action === 'static')
        setMode((current) => (current === 'live' ? 'static' : 'live'))
      else navigate(entryPath)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, entryPath])

  if (resource.kind === 'error') {
    return (
      <Page.Main>
        <Page.Title>{t('preview.title')}</Page.Title>
        <Layouts.Header title={t('preview.title')} />
        <Layouts.Content>
          <Typography role="alert">
            {t(resource.status === 404 ? 'preview.error.missing' : 'preview.error.entry')}
          </Typography>
        </Layouts.Content>
      </Page.Main>
    )
  }

  const title = entry?.title ?? t('preview.title')
  const width = DEVICES.find((item) => item.id === device)?.width ?? 1280
  const reason: PreviewSourceError | undefined =
    source.kind === 'error' ? source.reason : newTab.error
  const isSilent = frameState.isSilent && !isBlocked && source.kind === 'ready'
  const isUpgradeNeeded = frameState.protocol === 'upgrade'

  return (
    <Root>
      <Page.Main>
        <Page.Title>{t('preview.page', { title })}</Page.Title>
        <Layouts.Header
          title={title}
          subtitle={t('preview.subtitle')}
          navigationAction={
            <Link
              tag={NavLink}
              to={entryPath}
              aria-keyshortcuts="Control+Shift+ArrowLeft Meta+Shift+ArrowLeft"
            >
              {t('preview.back')}
            </Link>
          }
        />
        <Layouts.Content>
          <Columns>
            <div>
              <EntryColumn entry={entry} canEdit={canEdit} entryPath={entryPath} date={date} />
              <CostMeter resource={budget} onMeasureAgain={measureAgain} />
            </div>
            <section aria-label={t('preview.pane')}>
              <Flex gap={4} wrap="wrap" alignItems="center" marginBottom={3}>
                <Flex gap={2} role="group" aria-label={t('preview.device.group')}>
                  {DEVICES.map((item) => (
                    <Button
                      key={item.id}
                      type="button"
                      size="S"
                      variant={device === item.id ? 'default' : 'tertiary'}
                      aria-pressed={device === item.id}
                      aria-keyshortcuts={SHORTCUTS[item.id]}
                      onClick={() => setDevice(item.id)}
                    >
                      {t(`preview.device.${item.id}`, { width: item.width })}
                    </Button>
                  ))}
                </Flex>
                <Flex tag="label" gap={2} alignItems="center">
                  <input
                    type="checkbox"
                    checked={mode === 'static'}
                    aria-keyshortcuts={SHORTCUTS.static}
                    onChange={(event) => setMode(event.target.checked ? 'static' : 'live')}
                  />
                  <Typography>{t('preview.static')}</Typography>
                </Flex>
                {entry && entry.locales.length > 1 ? (
                  <Flex tag="label" gap={2} alignItems="center">
                    <Typography>{t('preview.locale')}</Typography>
                    <Select
                      value={entry.locale ?? ''}
                      onChange={(event) => setLocale(event.target.value)}
                    >
                      {entry.locales.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </Select>
                  </Flex>
                ) : null}
                <Button type="button" size="S" variant="tertiary" onClick={reload}>
                  {t('preview.reload')}
                </Button>
                <Button
                  type="button"
                  size="S"
                  variant="tertiary"
                  disabled={!entry}
                  onClick={() => void newTab.open()}
                >
                  {t('preview.newTab')}
                </Button>
                <Typography role="status" textColor="neutral700">
                  {frameState.isBusy ? t('preview.updating') : ''}
                </Typography>
              </Flex>
              <Typography variant="pi" textColor="neutral700" tag="p">
                {t('preview.shortcuts')}
              </Typography>
              <Box marginTop={3} marginBottom={3}>
                {reason ? <Notice role="alert" text={t(`preview.error.${reason}`)} /> : null}
                {isBlocked ? (
                  <Notice
                    role="alert"
                    title={t('preview.blocked.title')}
                    text={t('preview.blocked.body', { origin: origin ?? '' })}
                  />
                ) : null}
                {isUpgradeNeeded ? (
                  <Notice
                    role="status"
                    title={t('preview.upgrade.title')}
                    text={t('preview.upgrade.body', { versions: frameState.versions.join(', ') })}
                  />
                ) : null}
              </Box>
              <StageBox>
                {isSilent ? (
                  <Cover>
                    <Notice
                      role="status"
                      title={t('preview.silent.title')}
                      text={t('preview.silent.body')}
                    >
                      <Button type="button" onClick={() => void newTab.open()}>
                        {t('preview.newTab')}
                      </Button>
                    </Notice>
                  </Cover>
                ) : null}
                {isBlocked || source.kind === 'error' ? null : (
                  <PreviewFrame
                    ref={frame}
                    src={source.kind === 'ready' ? source.src : undefined}
                    origin={origin}
                    documentId={documentId}
                    locale={entry?.locale ?? null}
                    title={t('preview.frame.title', { title })}
                    width={width}
                    onChange={setFrameState}
                    onBlocked={() => setIsBlocked(true)}
                    isCovered={isSilent}
                  />
                )}
              </StageBox>
            </section>
          </Columns>
        </Layouts.Content>
      </Page.Main>
    </Root>
  )
}

/** The side of the entry: it is edited in the Content Manager, and the preview follows its saves. */
function EntryColumn(props: {
  entry: Entry | undefined
  canEdit: boolean
  entryPath: string
  date: (iso: string) => string
}) {
  const { t } = useMessages()
  const { locale } = useIntl()
  const { entry, canEdit, entryPath, date } = props
  // A new tab, so this page stays open and notices the save.
  const href = useHref(entryPath)
  return (
    <section aria-label={t('preview.entry.title')}>
      <Flex direction="column" alignItems="flex-start" gap={3}>
        <Typography variant="delta" tag="h2">
          {t('preview.entry.title')}
        </Typography>
        {canEdit ? null : (
          <Badge backgroundColor="neutral150" textColor="neutral700">
            {t('preview.entry.readOnly')}
          </Badge>
        )}
        <Typography>{t(canEdit ? 'preview.entry.body' : 'preview.entry.bodyReadOnly')}</Typography>
        {entry?.locale ? (
          <Typography textColor="neutral700">
            {t('preview.entry.locale', { locale: entry.locale })}
          </Typography>
        ) : null}
        {entry?.updatedAt ? (
          <Typography textColor="neutral700" lang={locale}>
            {t('preview.entry.saved', { date: date(entry.updatedAt) })}
          </Typography>
        ) : null}
        <Link href={href} isExternal>
          {t(canEdit ? 'preview.entry.open' : 'preview.entry.view')}
        </Link>
      </Flex>
    </section>
  )
}

function Notice(props: {
  role: 'alert' | 'status'
  title?: string
  text: string
  children?: ReactNode
}) {
  return (
    <Box
      role={props.role}
      padding={3}
      marginBottom={2}
      background="warning100"
      borderColor="warning200"
      hasRadius
    >
      {props.title ? (
        <Typography fontWeight="bold" tag="p">
          {props.title}
        </Typography>
      ) : null}
      <Typography tag="p">{props.text}</Typography>
      {props.children ? <Box marginTop={3}>{props.children}</Box> : null}
    </Box>
  )
}
