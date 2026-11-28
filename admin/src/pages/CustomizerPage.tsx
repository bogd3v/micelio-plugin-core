import { Box, Button, Dialog, Flex, Tabs, Typography } from '@strapi/design-system'
import { Page, useAuth } from '@strapi/strapi/admin'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { ChevronLeftIcon } from '../components/builder/icons'
import { Columns, Shell } from '../components/builder/layout'
import { AccentEditor, ContrastMatrix } from '../components/customize/AccentPanel'
import {
  Aside,
  Bar,
  Clock,
  Close,
  CUSTOMIZER_COLUMNS_PX,
  defaultTab,
  noFrameText,
  Pane,
  Stage,
} from '../components/customize/customizerLayout'
import { failureText, modeRows } from '../components/customize/ThemeColours'
import { PreviewFrame, type FrameState } from '../components/PreviewFrame'
import { candidatesKey, useContrast } from '../hooks/useContrast'
import { usePreviewSource } from '../hooks/usePreviewSource'
import { useSiteCustomization } from '../hooks/useSiteCustomization'
import { useSites } from '../hooks/useSites'
import { useMessages } from '../messages'
import { SITES_READ_PERMISSION, SITES_UPDATE_PERMISSION } from '../permissions'
import { PLUGIN_ID } from '../pluginId'
import {
  accentsBodyOf,
  blocksSave,
  candidatesOf,
  changedModes,
  isAccentColor,
  previewOverridesOf,
  type CustomizeValues,
} from '../utils/customize'
import { refusalText, DEFAULT_LOCALES } from '../utils/sitesPage'

/** How long the editor's typing must pause before the frame gets a new token, in milliseconds. */
const SETTLE_MS = 600

const can = (
  permissions: { action: string; subject?: string | null }[],
  wanted: { action: string; subject: string | null }
): boolean =>
  permissions.some(
    ({ action, subject }) =>
      action === wanted.action && (wanted.subject === null || subject === wanted.subject)
  )

/** The key of a list of preview overrides, or `''` for a token that carries none. */
const overridesKeyOf = (overrides: { mode: string; color: string }[] | undefined): string =>
  overrides === undefined ? '' : JSON.stringify(overrides)

/**
 * The customizer (#61): the accent of each mode of a site's theme beside a live preview of the
 * site, with the contrast matrix of the selected mode, at `customize/live?site=<slug>`.
 * `docs/guide/customize.md`, "The live preview", is the guide.
 */
export default function CustomizerPage() {
  const { t } = useMessages()
  return (
    <Page.Protect permissions={[SITES_READ_PERMISSION]}>
      <Page.Main>
        <Page.Title>{t('customizer.title')}</Page.Title>
        <CustomizerContent />
      </Page.Main>
    </Page.Protect>
  )
}

function CustomizerContent() {
  const { t } = useMessages()
  const [params] = useSearchParams()
  const { state: sites } = useSites()
  const slug = params.get('site') ?? ''
  const wanted = params.get('locale')
  const locale = wanted && DEFAULT_LOCALES.includes(wanted) ? wanted : (DEFAULT_LOCALES[0] ?? 'en')
  const back = `/plugins/${PLUGIN_ID}/customize?${new URLSearchParams({ site: slug, locale })}`

  if (sites.kind === 'loading') return <Page.Loading />
  const site = sites.kind === 'ready' ? sites.data.sites.find((s) => s.slug === slug) : undefined
  if (!site) {
    return (
      <Shell>
        <Bar>
          <Close to={back} aria-label={t('customizer.close')}>
            <ChevronLeftIcon />
          </Close>
          <Typography role="alert" textColor="danger600">
            {sites.kind === 'error'
              ? t('customize.sites.error')
              : t('customizer.site.missing', { slug })}
          </Typography>
        </Bar>
      </Shell>
    )
  }
  return (
    <Customizer
      key={`${site.documentId}-${locale}`}
      siteId={site.documentId}
      siteName={site.name}
      locale={locale}
      back={back}
    />
  )
}

function Customizer(props: { siteId: string; siteName: string; locale: string; back: string }) {
  const { t } = useMessages()
  const id = useId()
  const navigate = useNavigate()
  const permissions = useAuth('CustomizerPage', (auth) => auth.permissions)
  const canWrite = can(permissions, SITES_UPDATE_PERMISSION)
  const { state, save } = useSiteCustomization(props.siteId, props.locale)
  const [edits, setEdits] = useState<Record<string, string> | null>(null)
  const [selected, setSelected] = useState<string>()
  const [isSaving, setIsSaving] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: true } | { ok: false; text: string } | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)
  const [frameState, setFrameState] = useState<FrameState>()
  const [isBlocked, setIsBlocked] = useState(false)

  const saved: CustomizeValues | null = state.kind === 'ready' ? state.values : null
  const accents = edits ?? saved?.accents ?? {}
  const values: CustomizeValues | null = saved ? { ...saved, accents } : null
  const contrast = useContrast(props.siteId, candidatesOf(accents))

  // A new read (after a save) is the customizer's new start; a save ends with it, so the bar never
  // says "not saved" about what was just saved.
  useEffect(() => {
    setIsSaving(false)
    if (state.kind === 'ready') setEdits(null)
  }, [state])

  // The frame gets a new token once the accents stop changing, and only for accents a site can store.
  const overrides = saved ? previewOverridesOf(accents, saved.accents) : undefined
  const overridesKey = overridesKeyOf(overrides)
  const isAnyInvalid = Object.values(accents).some((color) => !isAccentColor(color))
  const [settledKey, setSettledKey] = useState('')
  useEffect(() => {
    if (isAnyInvalid) return
    const timer = window.setTimeout(() => setSettledKey(overridesKey), SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [overridesKey, isAnyInvalid])
  const settled = useMemo(
    () =>
      settledKey === '' ? undefined : (JSON.parse(settledKey) as { mode: string; color: string }[]),
    [settledKey]
  )
  const entry = contrast.frame
  const { source } = usePreviewSource(
    entry ? { uid: entry.uid, documentId: entry.documentId, locale: entry.locale } : undefined,
    'live',
    undefined,
    { accentOverrides: settled }
  )

  const isDirty = saved !== null && changedModes(accents, saved.accents).length > 0
  const close = useCallback(() => {
    if (isDirty) setIsConfirming(true)
    else navigate(props.back)
  }, [isDirty, navigate, props.back])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isConfirming || event.defaultPrevented) return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, isConfirming])

  if (state.kind === 'loading') return <Page.Loading />
  if (!values || !saved) {
    return (
      <Shell>
        <Bar>
          <Close to={props.back} aria-label={t('customizer.close')}>
            <ChevronLeftIcon />
          </Close>
          <Typography role="alert" textColor="danger600">
            {state.kind === 'error' && state.status === 404
              ? t('customize.entry.missing', { locale: props.locale })
              : t('customize.entry.error')}
          </Typography>
        </Bar>
      </Shell>
    )
  }

  const { rows } = modeRows(values, saved, contrast.state)
  const mode = rows.find((row) => row.mode === selected)?.mode ?? defaultTab(rows, saved)
  const row = rows.find((candidate) => candidate.mode === mode)
  const changed = changedModes(accents, saved.accents).length
  const failing = rows.filter((candidate) => blocksSave(candidate.check))
  const key = candidatesKey(candidatesOf(accents))
  const isCurrent = contrast.state.kind === 'ready' && contrast.state.key === key
  const isChecking =
    key !== candidatesKey(candidatesOf(saved.accents)) &&
    rows.some((candidate) => candidate.check.kind === 'checking' && candidate.accent !== '')
  const isBlockedSave = failing.length > 0 || isChecking || isAnyInvalid
  const theme = saved.pin.themeId
    ? t('customizer.theme.pinned', { id: saved.pin.themeId, version: saved.pin.themeVersion ?? '' })
    : t('customize.theme.default')
  const origin = source.kind === 'ready' ? source.origin : entry?.origin
  const isSilent = frameState?.isSilent === true && !isBlocked && source.kind === 'ready'

  // Why Save is off, for every mode that keeps it off (another tab's too), under the accent.
  const hint =
    failing.length > 0 ? (
      <Box
        id={`${id}-hint`}
        role="alert"
        data-testid="contrast-failures"
        background="danger100"
        hasRadius
        padding={3}
      >
        <Typography variant="pi" fontWeight="bold" tag="p">
          {t('customizer.save.disabled')}
        </Typography>
        {failing.map((candidate) => (
          <Typography key={candidate.mode} variant="pi" tag="p">
            {failureText(candidate, t)}
          </Typography>
        ))}
      </Box>
    ) : null

  // What the save is waiting for, or what it came to, under the accent too.
  const notes = (
    <>
      {isChecking ? (
        <Typography variant="pi" role="status" textColor="neutral600">
          {t('customize.contrast.checking')}
        </Typography>
      ) : null}
      {outcome?.ok && !isSaving ? (
        <Typography role="status" textColor="success600">
          {t('customize.save.done')}
        </Typography>
      ) : null}
      {outcome && !outcome.ok ? (
        <Typography role="alert" textColor="danger600">
          {outcome.text}
        </Typography>
      ) : null}
    </>
  )

  const setAccent = (color: string | undefined) => {
    if (!mode) return
    const next = { ...accents }
    if (color === undefined) delete next[mode]
    else next[mode] = color
    setOutcome(null)
    setEdits(next)
  }
  const discard = () => {
    setEdits(null)
    setOutcome(null)
    // The frame goes back to the saved accents at once: a token with none.
    setSettledKey('')
  }
  const submit = async () => {
    setIsSaving(true)
    setOutcome(null)
    const result = await save(values, accentsBodyOf)
    // A save that succeeds stays busy until the entry is read again.
    if (!result.ok) setIsSaving(false)
    setOutcome(
      result.ok
        ? { ok: true }
        : {
            ok: false,
            text:
              result.refusal === '' ? t('customize.save.failed') : refusalText(result.refusal, t),
          }
    )
  }

  return (
    <Tabs.Root value={mode ?? ''} onValueChange={setSelected} variant="simple">
      <Shell $from={CUSTOMIZER_COLUMNS_PX}>
        {contrast.frame ? (
          <div hidden>
            <PreviewFrame
              src={contrast.frame.src}
              origin={contrast.frame.origin}
              documentId={contrast.frame.documentId}
              locale={contrast.frame.locale}
              title={t('customize.frame')}
              width={1280}
              onChange={contrast.onFrame}
              onBlocked={contrast.onBlocked}
              isCovered
            />
          </div>
        ) : null}
        <Bar>
          <Close
            to={props.back}
            aria-label={t('customizer.close')}
            onClick={(event) => {
              if (!isDirty) return
              event.preventDefault()
              setIsConfirming(true)
            }}
          >
            <ChevronLeftIcon />
          </Close>
          <Flex direction="column" alignItems="flex-start">
            <Typography tag="h1" variant="delta" fontWeight="bold">
              {t('customizer.heading', { site: values.name || props.siteName })}
            </Typography>
            <Typography variant="pi" textColor="neutral600" data-testid="customizer-summary">
              {t('customizer.summary', { theme, changed, total: rows.length })}
            </Typography>
          </Flex>
          <Box marginLeft="auto">
            {rows.length > 0 ? (
              <Tabs.List aria-label={t('customizer.modes')}>
                {rows.map((candidate) => (
                  <Tabs.Trigger key={candidate.mode} value={candidate.mode}>
                    {candidate.mode}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            ) : null}
          </Box>
          {canWrite ? (
            <Flex gap={2}>
              <Button variant="tertiary" disabled={changed === 0 || isSaving} onClick={discard}>
                {t('customize.discard')}
              </Button>
              <Button
                loading={isSaving}
                disabled={changed === 0 || isBlockedSave}
                aria-describedby={failing.length > 0 ? `${id}-hint` : undefined}
                onClick={() => void submit()}
              >
                {t('customize.save')}
              </Button>
            </Flex>
          ) : null}
        </Bar>
        <Columns>
          {/* The matrix holds no control: the panel takes the focus, so the keyboard scrolls it. */}
          <Aside aria-label={t('customizer.accents')} tabIndex={0}>
            <Flex direction="column" alignItems="stretch" gap={1}>
              <Typography variant="sigma" textColor="neutral600" tag="h2">
                {t('customize.accents')}
              </Typography>
              <Typography variant="pi" textColor="neutral600">
                {t('customizer.accents.help')}
              </Typography>
            </Flex>
            {rows.length === 0 ? (
              contrast.state.kind === 'unchecked' ? (
                <Typography variant="pi" textColor="neutral600" data-testid="contrast-unchecked">
                  {t(`customize.unchecked.${contrast.state.reason}`)}
                </Typography>
              ) : (
                <Typography variant="pi" textColor="neutral600" role="status">
                  {t('customize.contrast.loading')}
                </Typography>
              )
            ) : null}
            {rows.map((candidate) => (
              <Tabs.Content key={candidate.mode} value={candidate.mode}>
                <Flex direction="column" alignItems="stretch" gap={5} paddingTop={1}>
                  {row && candidate.mode === row.mode ? (
                    <>
                      <AccentEditor row={row} isReadOnly={!canWrite} onChange={setAccent} />
                      {hint}
                      {notes}
                      <ContrastMatrix
                        mode={row.mode}
                        contrast={contrast.state}
                        isCurrent={isCurrent}
                      />
                    </>
                  ) : null}
                </Flex>
              </Tabs.Content>
            ))}
          </Aside>
          {/* Nor does the preview, for axe: the pane takes the focus too, to be scrolled when short. */}
          <Pane aria-label={t('customizer.preview')} tabIndex={0}>
            <Flex direction="column" alignItems="stretch" gap={3}>
              {entry ? (
                <>
                  <Flex gap={2} alignItems="center">
                    <Clock aria-hidden="true" width="14" height="14" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 8v4l3 2" />
                    </Clock>
                    <Typography
                      variant="pi"
                      textColor="neutral600"
                      tag="p"
                      data-testid="customizer-live"
                    >
                      {t(settledKey === '' ? 'customizer.live.saved' : 'customizer.live.unsaved', {
                        host: origin ? new URL(origin).host : '',
                        theme,
                      })}
                    </Typography>
                  </Flex>
                  <Typography variant="pi" textColor="neutral600" tag="p">
                    {t('customizer.live.mode')}
                  </Typography>
                </>
              ) : null}
              {!entry && contrast.state.kind === 'unchecked' ? (
                <Typography role="alert" textColor="neutral600" data-testid="customizer-no-frame">
                  {noFrameText(contrast.state.reason, t)}
                </Typography>
              ) : null}
              {source.kind === 'error' ? (
                <Typography role="alert" textColor="danger600">
                  {t(`preview.error.${source.reason}`)}
                </Typography>
              ) : null}
              {isBlocked ? (
                <Typography role="alert" textColor="danger600">
                  {t('preview.blocked.body', { origin: origin ?? '' })}
                </Typography>
              ) : null}
              {isSilent ? (
                <Typography role="status" textColor="neutral600">
                  {t('preview.silent.body')}
                </Typography>
              ) : null}
              {entry && !isBlocked && source.kind !== 'error' ? (
                <Stage>
                  <PreviewFrame
                    src={source.kind === 'ready' ? source.src : undefined}
                    origin={origin}
                    documentId={entry.documentId}
                    locale={entry.locale}
                    title={t('customizer.frame', { site: values.name || props.siteName })}
                    width={1280}
                    onChange={setFrameState}
                    onBlocked={() => setIsBlocked(true)}
                    isCovered={isSilent}
                  />
                </Stage>
              ) : null}
            </Flex>
          </Pane>
        </Columns>
      </Shell>
      <Dialog.Root open={isConfirming} onOpenChange={setIsConfirming}>
        <Dialog.Content>
          <Dialog.Header>{t('customizer.confirm.title')}</Dialog.Header>
          <Dialog.Body>
            <Typography>{t('customizer.confirm.body', { count: changed })}</Typography>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary">{t('customizer.confirm.stay')}</Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button variant="danger-light" onClick={() => navigate(props.back)}>
                {t('customizer.confirm.leave')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </Tabs.Root>
  )
}
