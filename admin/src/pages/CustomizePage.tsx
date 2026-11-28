import { Box, Button, Flex, LinkButton, Switch, Typography } from '@strapi/design-system'
import { Layouts, Page, useAuth } from '@strapi/strapi/admin'
import { useEffect, useId, useState } from 'react'
import { NavLink, useSearchParams } from 'react-router-dom'
import styled from 'styled-components'

import { Card, Field, SelectInput, TextArea, TextInput } from '../components/customize/fields'
import { LogoField } from '../components/customize/LogoField'
import { SocialLinks } from '../components/customize/SocialLinks'
import { ThemeColours, failureText, modeRows } from '../components/customize/ThemeColours'
import { PreviewFrame } from '../components/PreviewFrame'
import { candidatesKey, useContrast, type ContrastState } from '../hooks/useContrast'
import {
  useSiteCustomization,
  type CustomizationSaveOutcome,
  type CustomizationState,
} from '../hooks/useSiteCustomization'
import { useSites } from '../hooks/useSites'
import { useMessages } from '../messages'
import { SITES_READ_PERMISSION, SITES_UPDATE_PERMISSION } from '../permissions'
import { PLUGIN_ID } from '../pluginId'
import {
  MODULE_KEYS,
  blocksSave,
  candidatesOf,
  isLinkUrl,
  type CustomizeValues,
} from '../utils/customize'
import { refusalText, DEFAULT_LOCALES } from '../utils/sitesPage'

const can = (
  permissions: { action: string; subject?: string | null }[],
  wanted: { action: string; subject: string | null }
): boolean =>
  permissions.some(
    ({ action, subject }) =>
      action === wanted.action && (wanted.subject === null || subject === wanted.subject)
  )

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: ${({ theme }) => theme.spaces[4]};
  align-items: start;
`

const Pair = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: ${({ theme }) => theme.spaces[3]};
`

const SwitchRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.spaces[3]};
  padding: ${({ theme }) => theme.spaces[2]} 0;
  border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
`

/**
 * The Customize page (#60): what a site owner may change without touching the theme, one site and
 * one locale at a time. `docs/guide/customize.md` is the guide.
 */
export default function CustomizePage() {
  const { t } = useMessages()
  return (
    <Page.Protect permissions={[SITES_READ_PERMISSION]}>
      <Page.Main>
        <Page.Title>{t('customize.title')}</Page.Title>
        <CustomizeContent />
      </Page.Main>
    </Page.Protect>
  )
}

function CustomizeContent() {
  const { t } = useMessages()
  const id = useId()
  const { state: sites } = useSites()
  // The customizer's Close comes back with its site and locale (`?site=<slug>&locale=`).
  const [params] = useSearchParams()
  const [siteId, setSiteId] = useState<string>()
  const [locale, setLocale] = useState(() => {
    const wanted = params.get('locale')
    return wanted && DEFAULT_LOCALES.includes(wanted) ? wanted : (DEFAULT_LOCALES[0] ?? 'en')
  })
  const list = sites.kind === 'ready' ? sites.data.sites : []
  const chosen =
    list.find((site) => site.documentId === siteId) ??
    list.find((site) => site.slug === params.get('site')) ??
    list.find((site) => site.isDefault) ??
    list[0]

  if (sites.kind === 'loading') return <Page.Loading />
  return (
    <>
      <Layouts.Header
        title={t('customize.title')}
        subtitle={t('customize.subtitle')}
        primaryAction={
          chosen ? (
            <Flex gap={3} alignItems="flex-end" wrap="wrap">
              <Field id={`${id}-site`} label={t('customize.site')}>
                <SelectInput
                  id={`${id}-site`}
                  value={chosen.documentId}
                  onChange={(event) => setSiteId(event.target.value)}
                >
                  {list.map((site) => (
                    <option key={site.documentId} value={site.documentId}>
                      {site.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field id={`${id}-locale`} label={t('customize.locale')}>
                <SelectInput
                  id={`${id}-locale`}
                  value={locale}
                  onChange={(event) => setLocale(event.target.value)}
                >
                  {DEFAULT_LOCALES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <LinkButton
                tag={NavLink}
                variant="secondary"
                to={`/plugins/${PLUGIN_ID}/customize/live?${new URLSearchParams({ site: chosen.slug, locale })}`}
              >
                {t('customize.live.open')}
              </LinkButton>
            </Flex>
          ) : undefined
        }
      />
      <Layouts.Content>
        {sites.kind === 'error' ? (
          <Typography role="alert" textColor="danger600">
            {t('customize.sites.error')}
          </Typography>
        ) : chosen ? (
          <SiteForm key={chosen.documentId} siteId={chosen.documentId} locale={locale} />
        ) : (
          <Typography textColor="neutral600">{t('sites.none')}</Typography>
        )}
      </Layouts.Content>
    </>
  )
}

function SiteForm({ siteId, locale }: { siteId: string; locale: string }) {
  const { t } = useMessages()
  const permissions = useAuth('CustomizePage', (auth) => auth.permissions)
  const canWrite = can(permissions, SITES_UPDATE_PERMISSION)
  const { state, save } = useSiteCustomization(siteId, locale)
  const [edits, setEdits] = useState<CustomizeValues | null>(null)
  const saved = state.kind === 'ready' ? state.values : null
  const values = edits ?? saved
  const contrast = useContrast(siteId, candidatesOf(values?.accents ?? {}))

  // A new read (after a save) is the form's new start.
  useEffect(() => {
    if (state.kind === 'ready') setEdits(null)
  }, [state])

  const frame = contrast.frame ? (
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
  ) : null

  // The frame keeps its place whatever the form shows: its token was spent, and a new frame would
  // render the page on the frontend again.
  return (
    <>
      {frame}
      <SiteFields
        state={state}
        values={values}
        saved={saved}
        edits={edits}
        locale={locale}
        canWrite={canWrite}
        contrast={contrast.state}
        save={save}
        onEdit={setEdits}
      />
    </>
  )
}

/** The cards and the save bar of the form, or why there is no form. */
function SiteFields(props: {
  state: CustomizationState
  values: CustomizeValues | null
  saved: CustomizeValues | null
  edits: CustomizeValues | null
  locale: string
  canWrite: boolean
  contrast: ContrastState
  save: (values: CustomizeValues) => Promise<CustomizationSaveOutcome>
  /** The form's new values; `null` drops the edits (Discard). */
  onEdit: (values: CustomizeValues | null) => void
}) {
  const { t } = useMessages()
  const id = useId()
  const { state, values, saved, edits, locale, canWrite, save } = props
  const [isSaving, setIsSaving] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: true } | { ok: false; text: string } | null>(null)

  if (state.kind === 'loading') return <Page.Loading />
  if (state.kind === 'error' || !values || !saved) {
    return (
      <Typography role="alert" textColor="danger600">
        {state.kind === 'error' && state.status === 404
          ? t('customize.entry.missing', { locale })
          : t('customize.entry.error')}
      </Typography>
    )
  }

  const set = (patch: Partial<CustomizeValues>) => {
    setOutcome(null)
    props.onEdit({ ...values, ...patch })
  }
  const { rows, modes } = modeRows(values, saved, props.contrast)
  const failing = rows.filter((row) => blocksSave(row.check))
  const isChecking =
    candidatesKey(candidatesOf(values.accents)) !== candidatesKey(candidatesOf(saved.accents)) &&
    rows.some((row) => row.check.kind === 'checking' && row.accent !== '')
  const isNameMissing = values.name.trim() === ''
  const isAuthorUrlBad = values.authorUrl.trim() !== '' && !isLinkUrl(values.authorUrl)
  const isAuthorNameMissing = values.authorName.trim() === '' && values.authorUrl.trim() !== ''
  const isInvalid =
    isNameMissing ||
    values.socialLinks.some((link) => !isLinkUrl(link.url)) ||
    isAuthorUrlBad ||
    isAuthorNameMissing ||
    rows.some((row) => row.check.kind === 'invalid')
  const isBlocked = failing.length > 0 || isChecking
  const isDirty = edits !== null

  const submit = async () => {
    setIsSaving(true)
    setOutcome(null)
    const result = await save(values)
    setIsSaving(false)
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
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Grid>
        <Card id={`${id}-identity`} title={t('customize.identity')}>
          <Pair>
            <Field
              id={`${id}-name`}
              label={t('customize.name')}
              isRequired
              error={isNameMissing ? t('customize.name.missing') : undefined}
            >
              <TextInput
                id={`${id}-name`}
                value={values.name}
                required
                readOnly={!canWrite}
                aria-invalid={isNameMissing}
                onChange={(event) => set({ name: event.target.value })}
              />
            </Field>
            <Field id={`${id}-tagline`} label={t('customize.tagline')}>
              <TextInput
                id={`${id}-tagline`}
                value={values.tagline}
                readOnly={!canWrite}
                onChange={(event) => set({ tagline: event.target.value })}
              />
            </Field>
          </Pair>
          <Field
            id={`${id}-description`}
            label={t('customize.description')}
            help={t('customize.description.help', {
              locale,
              other: DEFAULT_LOCALES.filter((code) => code !== locale).join(', '),
            })}
          >
            <TextArea
              id={`${id}-description`}
              rows={2}
              value={values.description}
              readOnly={!canWrite}
              aria-describedby={`${id}-description-help`}
              onChange={(event) => set({ description: event.target.value })}
            />
          </Field>
          <Pair>
            <LogoField
              logo={values.logo}
              isReadOnly={!canWrite}
              onChange={(logo) => set({ logo })}
            />
            <Flex
              direction="column"
              alignItems="stretch"
              gap={2}
              role="group"
              aria-labelledby={`${id}-author`}
            >
              <Typography variant="pi" fontWeight="bold" tag="span" id={`${id}-author`}>
                {t('customize.author')}
              </Typography>
              <Field
                id={`${id}-author-name`}
                label={t('customize.author.name')}
                error={isAuthorNameMissing ? t('customize.author.name.missing') : undefined}
              >
                <TextInput
                  id={`${id}-author-name`}
                  value={values.authorName}
                  readOnly={!canWrite}
                  aria-invalid={isAuthorNameMissing}
                  onChange={(event) => set({ authorName: event.target.value })}
                />
              </Field>
              <Field
                id={`${id}-author-url`}
                label={t('customize.author.url')}
                error={isAuthorUrlBad ? t('customize.url.invalid') : undefined}
              >
                <TextInput
                  id={`${id}-author-url`}
                  type="url"
                  value={values.authorUrl}
                  readOnly={!canWrite}
                  aria-invalid={isAuthorUrlBad}
                  onChange={(event) => set({ authorUrl: event.target.value })}
                />
              </Field>
            </Flex>
          </Pair>
        </Card>

        <Card id={`${id}-theme`} title={t('customize.themeColours')}>
          <ThemeColours
            values={values}
            rows={rows}
            modes={modes}
            contrast={props.contrast}
            isReadOnly={!canWrite}
            onChange={set}
          />
        </Card>

        <Card id={`${id}-modules`} title={t('customize.modules')}>
          <Flex direction="column" alignItems="stretch">
            {MODULE_KEYS.map((key) => (
              <SwitchRow key={key}>
                <Typography id={`${id}-module-${key}`}>{t(`customize.module.${key}`)}</Typography>
                <Switch
                  checked={values.modules[key] !== false}
                  disabled={!canWrite}
                  aria-label={t(`customize.module.${key}.name`)}
                  aria-describedby={`${id}-module-${key}`}
                  onCheckedChange={(checked: boolean) =>
                    set({ modules: { ...values.modules, [key]: checked } })
                  }
                />
              </SwitchRow>
            ))}
          </Flex>
          <Typography variant="pi" textColor="neutral600">
            {t('customize.modules.help')}
          </Typography>
        </Card>

        <Card id={`${id}-social`} title={t('customize.social')}>
          <SocialLinks
            links={values.socialLinks}
            isReadOnly={!canWrite}
            onChange={(socialLinks) => set({ socialLinks })}
          />
        </Card>
      </Grid>

      <Box background="neutral0" hasRadius shadow="filterShadow" padding={5}>
        <Flex justifyContent="space-between" alignItems="center" gap={4} wrap="wrap">
          <Flex direction="column" alignItems="flex-start" gap={2} style={{ flex: '1 1 360px' }}>
            {failing.length > 0 ? (
              <Box role="alert" data-testid="contrast-failures">
                {failing.map((row) => (
                  <Typography key={row.mode} tag="p" textColor="danger600">
                    {failureText(row, t)}
                  </Typography>
                ))}
              </Box>
            ) : null}
            {isChecking ? (
              <Typography role="status" textColor="neutral600">
                {t('customize.contrast.checking')}
              </Typography>
            ) : null}
            {outcome?.ok ? (
              <Typography role="status" textColor="success600">
                {t('customize.save.done')}
              </Typography>
            ) : null}
            {outcome && !outcome.ok ? (
              <Typography role="alert" textColor="danger600">
                {outcome.text}
              </Typography>
            ) : null}
            <Typography variant="pi" textColor="neutral600">
              {t('customize.notHere')}
            </Typography>
          </Flex>
          {canWrite ? (
            <Flex gap={2}>
              <Button
                variant="tertiary"
                disabled={!isDirty || isSaving}
                onClick={() => {
                  props.onEdit(null)
                  setOutcome(null)
                }}
              >
                {t('customize.discard')}
              </Button>
              <Button
                loading={isSaving}
                disabled={!isDirty || isInvalid || isBlocked}
                onClick={() => void submit()}
              >
                {t('customize.save')}
              </Button>
            </Flex>
          ) : null}
        </Flex>
      </Box>
    </Flex>
  )
}
