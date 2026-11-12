import { useId } from 'react'
import { useTheme } from 'styled-components'

import { useMessages } from '../../messages'
import type { RunPhase } from '../../utils/builder/run'

interface RunHereProps {
  /** Where the last run of the block stands; `undefined` before its first. */
  phase: RunPhase | undefined
  /** The frame in view can be asked to run the block. */
  canRun: boolean
  isReadOnly: boolean
  onRun: () => void
}

/**
 * "Run here and fill expected output" (the Heavy islands artboard): the preview frame runs the
 * Playground block as the saved draft holds it, and its output fills **Expected output**, the
 * static alternative of a runtime island (ADR-0019, amendment of 2026-11-06).
 *
 * @remarks
 * The admin never runs the code. The panel says while the page saves and while the frame runs it,
 * and why a run filled nothing; the field stays as it was then. The output of a failed run is shown
 * as text, never as HTML.
 */
export function RunHere(props: RunHereProps) {
  const { colors } = useTheme()
  const { t } = useMessages()
  const id = useId()
  const { phase } = props
  const isBusy = phase?.kind === 'saving' || phase?.kind === 'running'
  const isDisabled = props.isReadOnly || !props.canRun || isBusy
  const status =
    phase?.kind === 'saving'
      ? t('builder.island.runSaving')
      : phase?.kind === 'running'
        ? t('builder.island.running')
        : phase?.kind === 'filled'
          ? t(phase.truncated ? 'builder.island.runFilledTruncated' : 'builder.island.runFilled')
          : ''
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="run-here">
      <button
        type="button"
        disabled={isDisabled}
        aria-describedby={`${id}-note`}
        onClick={props.onRun}
        style={{
          alignSelf: 'flex-start',
          height: 36,
          padding: '0 12px',
          border: `1px solid ${colors.neutral200}`,
          borderRadius: 4,
          background: isDisabled ? colors.neutral150 : colors.neutral0,
          color: isDisabled ? colors.neutral600 : colors.primary600,
          fontSize: 13,
          fontWeight: 600,
          textAlign: 'left',
          cursor: isDisabled ? 'default' : 'pointer',
        }}
      >
        {t('builder.island.run')}
      </button>
      <span id={`${id}-note`} style={{ fontSize: 12, color: colors.neutral600 }}>
        {t(props.canRun ? 'builder.island.runNote' : 'builder.island.runUnavailable')}
      </span>
      <span
        role="status"
        data-testid="run-status"
        aria-busy={isBusy}
        style={{ fontSize: 12, color: colors.neutral800 }}
      >
        {status}
      </span>
      {phase?.kind === 'failed' ? (
        <div role="alert" data-testid="run-error" style={{ fontSize: 12, color: colors.danger700 }}>
          {t(`builder.island.runFailed.${phase.reason}`)}
          {phase.output ? (
            <pre
              data-testid="run-error-output"
              // It scrolls past 160 pixels: the keyboard reaches it.
              tabIndex={0}
              style={{
                margin: '4px 0 0',
                padding: 8,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                maxHeight: 160,
                overflow: 'auto',
                background: colors.danger100,
                border: `1px solid ${colors.danger200}`,
                borderRadius: 4,
                color: colors.neutral800,
              }}
            >
              {phase.output}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
