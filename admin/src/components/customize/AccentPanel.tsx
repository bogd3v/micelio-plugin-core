import { Box, Button, Flex, Typography } from '@strapi/design-system'
import { useId, useRef } from 'react'
import styled from 'styled-components'

import type { ContrastState, ContrastUnchecked } from '../../hooks/useContrast'
import { useMessages } from '../../messages'
import { isAccentColor, type ContrastPair } from '../../utils/customize'
import { TextInput } from './fields'
import { pairText, type ModeRow } from './ThemeColours'

const Swatch = styled.span<{ $color: string | undefined }>`
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  background: ${({ $color, theme }) => $color ?? theme.colors.neutral100};
`

/** The result beside the field, as the artboard's pill: a dot and the word, on the result's tint. */
const Pill = styled.span<{ $tone: 'success' | 'danger' | 'neutral' }>`
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 4px;
  background: ${({ $tone, theme }) => theme.colors[`${$tone}100`]};
  &::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${({ $tone, theme }) => theme.colors[`${$tone}600`]};
  }
`

/** The accent field in the artboard's monospace, as a colour code reads. */
const CodeInput = styled(TextInput)`
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`

const Heading = styled.h2`
  margin: 0;
  font-size: 1.2rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${({ theme }) => theme.colors.neutral600};
`

const Matrix = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 1.2rem;
  color: ${({ theme }) => theme.colors.neutral800};
  th,
  td {
    padding: ${({ theme }) => `${theme.spaces[1]} ${theme.spaces[2]}`};
    border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
    text-align: left;
  }
  th {
    font-weight: 600;
    color: ${({ theme }) => theme.colors.neutral600};
  }
  td:nth-child(2),
  td:nth-child(3),
  th:nth-child(2),
  th:nth-child(3) {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
`

/**
 * The accent of the selected mode in the customizer (#61): its colour field, its AA result, "Use
 * <shade>" when the frontend would move the candidate, and "Reset to theme", which drops the mode's
 * override. Only the accent per mode is an override (ADR-0005 of `micelio`, section 8).
 */
export function AccentEditor(props: {
  row: ModeRow
  isReadOnly: boolean
  /** The mode's new accent; `undefined` drops its override. */
  onChange: (color: string | undefined) => void
}) {
  const { t } = useMessages()
  const id = useId()
  const { row, isReadOnly, onChange } = props
  const { check } = row
  const shown = isAccentColor(row.accent) ? row.accent : undefined
  const isFailing = check.kind === 'adjusted' || check.kind === 'fails'
  const input = useRef<HTMLInputElement>(null)
  // Use and Reset leave with the button they were pressed on: the focus goes to the field instead.
  const choose = (color: string | undefined) => {
    onChange(color)
    input.current?.focus()
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      <Typography tag="label" htmlFor={`${id}-accent`} variant="pi" fontWeight="bold">
        {t('customize.accent.label', { mode: row.mode })}
      </Typography>
      <Flex gap={2} alignItems="center">
        <Swatch $color={shown} aria-hidden="true" />
        <Box style={{ flex: '1 1 120px', minWidth: 120 }}>
          <CodeInput
            ref={input}
            id={`${id}-accent`}
            aria-invalid={check.kind === 'invalid' || isFailing}
            aria-describedby={`${id}-result`}
            placeholder={t('customizer.accent.placeholder')}
            maxLength={7}
            spellCheck={false}
            value={row.accent}
            readOnly={isReadOnly}
            onChange={(event) =>
              onChange(event.target.value === '' ? undefined : event.target.value)
            }
          />
        </Box>
        <Pill
          $tone={
            check.kind === 'passes'
              ? 'success'
              : isFailing || check.kind === 'invalid'
                ? 'danger'
                : 'neutral'
          }
        >
          <Typography
            variant="pi"
            fontWeight="bold"
            textColor={
              check.kind === 'passes'
                ? 'success700'
                : isFailing || check.kind === 'invalid'
                  ? 'danger700'
                  : 'neutral700'
            }
          >
            {t(`customizer.pill.${check.kind}`)}
          </Typography>
        </Pill>
      </Flex>
      <Typography
        id={`${id}-result`}
        variant="pi"
        textColor={isFailing ? 'danger600' : 'neutral600'}
        data-testid="accent-result"
      >
        {check.kind === 'adjusted'
          ? t('customizer.accent.adjusted', { shade: check.shade, pair: pairOf(check.pair, t) })
          : check.kind === 'fails'
            ? t('customizer.accent.fails', { pair: pairOf(check.pair, t) })
            : row.accent === ''
              ? t('customizer.accent.theme')
              : t('customizer.accent.override', { color: row.accent })}
      </Typography>
      {!isReadOnly ? (
        <Flex gap={2} wrap="wrap">
          {check.kind === 'adjusted' ? (
            <Button variant="secondary" size="S" onClick={() => choose(check.shade)}>
              {t('customize.accent.use', { shade: check.shade })}
            </Button>
          ) : null}
          {row.accent !== '' ? (
            <Button variant="tertiary" size="S" onClick={() => choose(undefined)}>
              {t('customizer.accent.reset')}
            </Button>
          ) : null}
        </Flex>
      ) : null}
    </Flex>
  )
}

/**
 * The contrast matrix of the selected mode (#61): each pair of the contrast route's answer for the
 * current candidates, `role` on `surface`, its ratio, the minimum and whether it passes; or why
 * there is none yet.
 */
export function ContrastMatrix(props: {
  mode: string
  contrast: ContrastState
  /** Whether the answer is for the candidates in the form; while not, the matrix says it checks. */
  isCurrent: boolean
}) {
  const { t } = useMessages()
  const id = useId()
  const { mode, contrast, isCurrent } = props
  const pairs: ContrastPair[] | undefined =
    contrast.kind === 'ready'
      ? contrast.answer.modes.find((entry) => entry.mode === mode)?.pairs
      : undefined

  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      <Heading id={`${id}-matrix`}>{t('customizer.matrix', { mode })}</Heading>
      {contrast.kind === 'unchecked' ? (
        <Typography variant="pi" textColor="neutral600" data-testid="contrast-unchecked">
          {t(`customize.unchecked.${contrast.reason satisfies ContrastUnchecked}`)}
        </Typography>
      ) : !pairs ? (
        <Typography variant="pi" textColor="neutral600" role="status">
          {t('customize.contrast.loading')}
        </Typography>
      ) : (
        <>
          <Matrix
            aria-labelledby={`${id}-matrix`}
            data-testid="contrast-matrix"
            aria-busy={!isCurrent}
          >
            <thead>
              <tr>
                <th scope="col">{t('customizer.matrix.pair')}</th>
                <th scope="col">{t('customizer.matrix.ratio')}</th>
                <th scope="col">{t('customizer.matrix.min')}</th>
                <th scope="col">{t('customizer.matrix.result')}</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((pair) => (
                <tr key={`${pair.role}-${pair.surface}`}>
                  <td>{t('customizer.matrix.on', { role: pair.role, surface: pair.surface })}</td>
                  <td>{pair.ratio === null ? '–' : `${pair.ratio.toFixed(2)}:1`}</td>
                  <td>{`${pair.min}:1`}</td>
                  <td>
                    <Typography
                      variant="pi"
                      fontWeight="bold"
                      textColor={pair.passes ? 'success600' : 'danger600'}
                    >
                      {pair.passes ? t('customize.result.passes') : t('customizer.matrix.fails')}
                    </Typography>
                  </td>
                </tr>
              ))}
            </tbody>
          </Matrix>
          {!isCurrent ? (
            <Typography variant="pi" textColor="neutral600" role="status">
              {t('customize.result.checking')}
            </Typography>
          ) : null}
        </>
      )}
    </Flex>
  )
}

/** The pair a failing mode names, or that no shade of the accent passes. */
function pairOf(
  pair: ContrastPair | undefined,
  t: (id: string, values?: Record<string, string | number>) => string
): string {
  return pair ? pairText(pair, t) : t('customize.pair.none')
}
