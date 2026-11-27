import { Box, Button, Flex, Typography } from '@strapi/design-system'
import { useId } from 'react'
import styled from 'styled-components'

import { candidatesKey, type ContrastState, type ContrastUnchecked } from '../../hooks/useContrast'
import { useMessages } from '../../messages'
import {
  DISPLAY_FONTS,
  accentResult,
  candidatesOf,
  isAccentColor,
  type AccentResult,
  type ContrastPair,
  type CustomizeValues,
} from '../../utils/customize'
import { Field, SelectInput, TextInput } from './fields'

/** What the page knows of one mode's accent: the route's result, or why there is none yet. */
export type ModeCheck =
  | AccentResult
  | { kind: 'checking' }
  | { kind: 'invalid' }
  | { kind: 'unchecked'; reason: ContrastUnchecked }

/** One mode of the theme as the section lists it. */
export interface ModeRow {
  mode: string
  /** The override in the form, as typed; empty for the theme's own accent. */
  accent: string
  check: ModeCheck
}

const Swatch = styled.span<{ $color: string | undefined }>`
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  background: ${({ $color, theme }) => $color ?? theme.colors.neutral100};
`

const Chip = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${({ theme }) => theme.spaces[3]};
  padding: ${({ theme }) => `${theme.spaces[2]} ${theme.spaces[3]}`};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
`

/** The text of a pair, as `theme:check` prints it: `accent on surface 3.21:1, needs 4.5:1`. */
export function pairText(
  pair: ContrastPair,
  t: (id: string, values?: Record<string, string | number>) => string
): string {
  return t('customize.pair', {
    role: pair.role,
    surface: pair.surface,
    ratio: pair.ratio === null ? '–' : pair.ratio.toFixed(2),
    min: pair.min,
  })
}

/**
 * The modes the card lists, each with its check: the route's result for the form's accent, or why
 * there is none yet. The modes are the route's, then those of a saved or typed override it lacks.
 */
export function modeRows(
  values: CustomizeValues,
  saved: CustomizeValues,
  contrast: ContrastState
): { rows: ModeRow[]; modes: string[] | undefined } {
  const candidates = candidatesOf(values.accents)
  const key = candidatesKey(candidates)
  const answer = contrast.kind === 'ready' ? contrast.answer : undefined
  const modes = answer?.modes.map(({ mode }) => mode)
  const listed = [...(modes ?? [])]
  for (const mode of [...Object.keys(saved.accents), ...Object.keys(values.accents)]) {
    if (!listed.includes(mode)) listed.push(mode)
  }
  const rows = listed.map((mode): ModeRow => {
    const accent = values.accents[mode] ?? ''
    let check: ModeCheck
    if (accent !== '' && !isAccentColor(accent)) check = { kind: 'invalid' }
    else if (contrast.kind === 'unchecked') check = { kind: 'unchecked', reason: contrast.reason }
    else if (contrast.kind === 'loading' || contrast.key !== key) check = { kind: 'checking' }
    else check = accentResult(contrast.answer, mode, accent === '' ? undefined : accent)
    return { mode, accent, check }
  })
  return { rows, modes }
}

/** The sentence that says why a mode keeps Save off: the mode, the shade or the pair. */
export function failureText(
  row: ModeRow,
  t: (id: string, values?: Record<string, string | number>) => string
): string {
  const { check, mode, accent } = row
  const pair = check.kind === 'adjusted' || check.kind === 'fails' ? check.pair : undefined
  const pairPart = pair ? pairText(pair, t) : t('customize.pair.none')
  if (check.kind === 'adjusted') {
    return t('customize.failure.adjusted', {
      mode,
      color: accent,
      shade: check.shade,
      pair: pairPart,
    })
  }
  return t('customize.failure.fails', { mode, color: accent, pair: pairPart })
}

function ResultText({ check }: { check: ModeCheck }) {
  const { t } = useMessages()
  switch (check.kind) {
    case 'passes':
      return (
        <Typography variant="pi" fontWeight="bold" textColor="success600">
          {t('customize.result.passes')}
        </Typography>
      )
    case 'adjusted':
      return (
        <Typography variant="pi" fontWeight="bold" textColor="danger600">
          {t('customize.result.adjusted', { shade: check.shade })}
        </Typography>
      )
    case 'fails':
      return (
        <Typography variant="pi" fontWeight="bold" textColor="danger600">
          {t('customize.result.fails')}
        </Typography>
      )
    case 'theme':
      return (
        <Typography variant="pi" textColor="neutral600">
          {t('customize.result.theme')}
        </Typography>
      )
    case 'checking':
      return (
        <Typography variant="pi" textColor="neutral600">
          {t('customize.result.checking')}
        </Typography>
      )
    case 'invalid':
      return (
        <Typography variant="pi" fontWeight="bold" textColor="danger600">
          {t('customize.result.invalid')}
        </Typography>
      )
    default:
      return (
        <Typography variant="pi" textColor="neutral600">
          {t('customize.result.unchecked')}
        </Typography>
      )
  }
}

/**
 * The Theme and colours card: the theme as pinned, a chip per mode with its accent and AA result,
 * the accent field of each mode, the display font and the default mode.
 *
 * @remarks
 * Only the accent per mode is an override (ADR-0005 of `micelio`, section 8). The modes are those
 * the contrast route lists; with no answer, the modes that have an override. The default mode offers
 * the route's modes, or, with no answer, only the saved one.
 */
export function ThemeColours(props: {
  values: CustomizeValues
  rows: ModeRow[]
  contrast: ContrastState
  /** The modes the contrast route listed, in its order; `undefined` with no answer. */
  modes: string[] | undefined
  isReadOnly: boolean
  onChange: (patch: Partial<CustomizeValues>) => void
}) {
  const { t } = useMessages()
  const id = useId()
  const { values, rows, contrast, modes, isReadOnly, onChange } = props
  const { pin } = values
  const setAccent = (mode: string, color: string | undefined) => {
    const accents = { ...values.accents }
    if (color === undefined) delete accents[mode]
    else accents[mode] = color
    onChange({ accents })
  }
  const defaultModes = modes ?? (values.defaultMode ? [values.defaultMode] : [])
  const overrides = Object.keys(values.accents).length

  return (
    <>
      <Flex direction="column" alignItems="flex-start" gap={1}>
        <Typography fontWeight="bold" data-testid="customize-theme">
          {pin.themeId
            ? t('customize.theme.pinned', { id: pin.themeId, version: pin.themeVersion ?? '' })
            : t('customize.theme.default')}
        </Typography>
        <Typography variant="pi" textColor="neutral600">
          {t('customize.theme.overrides', { count: overrides })}
        </Typography>
      </Flex>

      <Flex direction="column" alignItems="stretch" gap={2}>
        <Typography variant="pi" fontWeight="bold" tag="h3">
          {t('customize.accents')}{' '}
          <Typography variant="pi" fontWeight="regular" textColor="neutral600">
            {t('customize.accents.bounds')}
          </Typography>
        </Typography>
        {contrast.kind === 'unchecked' ? (
          <Typography variant="pi" textColor="neutral600" data-testid="contrast-unchecked">
            {t(`customize.unchecked.${contrast.reason}`)}
          </Typography>
        ) : null}
        {rows.length === 0 && contrast.kind === 'loading' ? (
          <Typography variant="pi" textColor="neutral600" role="status">
            {t('customize.contrast.loading')}
          </Typography>
        ) : null}
        {rows.map((row) => {
          const fieldId = `${id}-accent-${row.mode}`
          const shown = isAccentColor(row.accent) ? row.accent : undefined
          return (
            <Chip key={row.mode} role="group" aria-label={t('customize.mode', { mode: row.mode })}>
              <Flex gap={2} alignItems="center" data-testid={`chip-${row.mode}`}>
                <Swatch $color={shown} aria-hidden="true" />
                <Typography variant="pi">
                  {row.accent === ''
                    ? t('customize.chip.theme', { mode: row.mode })
                    : t('customize.chip.override', { mode: row.mode, color: row.accent })}
                </Typography>
                <span aria-hidden="true">·</span>
                <ResultText check={row.check} />
              </Flex>
              <Box style={{ flex: '1 1 140px', maxWidth: 180 }}>
                <TextInput
                  id={fieldId}
                  aria-label={t('customize.accent.label', { mode: row.mode })}
                  aria-invalid={row.check.kind === 'invalid'}
                  placeholder="#RRGGBB"
                  maxLength={7}
                  spellCheck={false}
                  value={row.accent}
                  readOnly={isReadOnly}
                  onChange={(event) =>
                    setAccent(row.mode, event.target.value === '' ? undefined : event.target.value)
                  }
                />
              </Box>
              {!isReadOnly && row.check.kind === 'adjusted' ? (
                <Button
                  variant="secondary"
                  size="S"
                  onClick={() =>
                    setAccent(row.mode, row.check.kind === 'adjusted' ? row.check.shade : undefined)
                  }
                >
                  {t('customize.accent.use', { shade: row.check.shade })}
                </Button>
              ) : null}
              {!isReadOnly && row.accent !== '' ? (
                <Button variant="tertiary" size="S" onClick={() => setAccent(row.mode, undefined)}>
                  {t('customize.accent.remove', { mode: row.mode })}
                </Button>
              ) : null}
            </Chip>
          )
        })}
        <Typography variant="pi" textColor="neutral600">
          {t('customize.accents.help')}
        </Typography>
      </Flex>

      <Box
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        <Field id={`${id}-font`} label={t('customize.font')} help={t('customize.font.help')}>
          <SelectInput
            id={`${id}-font`}
            value={values.displayFont}
            disabled={isReadOnly}
            aria-describedby={`${id}-font-help`}
            onChange={(event) => onChange({ displayFont: event.target.value })}
          >
            <option value="">{t('customize.themeDefault')}</option>
            {DISPLAY_FONTS.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field
          id={`${id}-mode`}
          label={t('customize.defaultMode')}
          help={t('customize.defaultMode.help')}
        >
          <SelectInput
            id={`${id}-mode`}
            value={values.defaultMode}
            disabled={isReadOnly}
            aria-describedby={`${id}-mode-help`}
            onChange={(event) => onChange({ defaultMode: event.target.value })}
          >
            <option value="">{t('customize.themeDefault')}</option>
            {defaultModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </SelectInput>
        </Field>
      </Box>
    </>
  )
}
