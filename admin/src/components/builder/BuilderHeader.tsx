import { Badge, Button, Typography } from '@strapi/design-system'
import { NavLink } from 'react-router-dom'
import styled, { useTheme } from 'styled-components'

import type { BudgetResource } from '../../hooks/useBudget'
import type { BuilderDocument, SaveStatus } from '../../hooks/useBuilderDocument'
import { useMessages } from '../../messages'
import { DEVICES, type DeviceId, type PreviewMode } from '../../utils/previewPane'
import { CostMeter } from '../CostMeter'
import { Tool } from './controls'
import { ChevronLeftIcon, DesktopIcon, GearIcon, PhoneIcon, TabletIcon } from './icons'

const Bar = styled.header`
  min-height: 64px;
  box-sizing: border-box;
  padding: 10px 16px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  background: ${({ theme }) => theme.colors.neutral0};
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
`

const Back = styled(NavLink)`
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.neutral800};
  transition: background var(--m-fast) var(--m-ease-out);
  &:hover {
    background: ${({ theme }) => theme.colors.neutral100};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
`

const Toggle = styled.button<{ $isPressed: boolean }>`
  all: unset;
  box-sizing: border-box;
  width: 40px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1px solid
    ${({ $isPressed, theme }) => ($isPressed ? theme.colors.primary600 : theme.colors.neutral200)};
  background: ${({ $isPressed, theme }) => ($isPressed ? theme.colors.primary100 : theme.colors.neutral0)};
  color: ${({ $isPressed, theme }) => ($isPressed ? theme.colors.primary600 : theme.colors.neutral800)};
  transition:
    background var(--m-fast) var(--m-ease-out),
    color var(--m-fast) var(--m-ease-out);
  &:first-child {
    border-radius: 4px 0 0 4px;
  }
  &:last-child {
    border-radius: 0 4px 4px 0;
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
`

const ICONS = { phone: <PhoneIcon />, tablet: <TabletIcon />, desktop: <DesktopIcon /> }

interface BuilderHeaderProps {
  title: string
  document: BuilderDocument | undefined
  /** `Page · Landing`'s first part: the kind of document. */
  kind: string
  entryPath: string
  status: SaveStatus
  isDirty: boolean
  /** "12 s ago" style text for the last save, or `undefined` before the first. */
  savedAgo: string | undefined
  device: DeviceId
  onDevice: (device: DeviceId) => void
  mode: PreviewMode
  onMode: (mode: PreviewMode) => void
  budget: BudgetResource
  onSave: () => void
  isReadOnly: boolean
  /** Opens the page settings; `undefined` for a page type that has none, which shows no gear. */
  onOpenSettings: (() => void) | undefined
  isSettingsOpen: boolean
}

/** The word a screen reader hears when the save status changes. */
function statusKey(status: SaveStatus, isDirty: boolean): string {
  if (status === 'saving') return 'builder.save.saving'
  if (status === 'failed') return 'builder.save.failed'
  if (status === 'conflict') return 'builder.save.conflict'
  if (status === 'incomplete') return 'builder.save.incomplete'
  if (isDirty) return 'builder.save.pending'
  return status === 'saved' ? 'builder.save.saved' : 'builder.save.idle'
}

/**
 * The toolbar of the builder (the Builder artboard): back to the entry, the title with its state,
 * where autosave stands, the preview width, "As static site", the page weight and Save. The gear
 * next to the title opens the page settings (the Page settings artboard).
 *
 * @remarks
 * "Send to review" is not here until its flow exists (issue #57).
 */
export function BuilderHeader(props: BuilderHeaderProps) {
  const { colors } = useTheme()
  const { t } = useMessages()
  const { document: doc } = props
  const state = doc?.state ?? 'draft'
  const parts = [props.kind, doc?.site, doc?.locale].filter((part): part is string => Boolean(part))
  return (
    <Bar>
      <Back to={props.entryPath} aria-label={t('builder.back')}>
        <ChevronLeftIcon />
      </Back>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Typography tag="h1" variant="delta" fontWeight="bold">
            {props.title}
          </Typography>
          <Badge
            backgroundColor={state === 'draft' ? 'neutral150' : 'warning100'}
            textColor="neutral800"
          >
            {t(`builder.state.${state}`)}
          </Badge>
          {props.onOpenSettings ? (
            <Tool
              type="button"
              aria-label={t('builder.settings.open')}
              aria-keyshortcuts="Control+Comma Meta+Comma"
              aria-expanded={props.isSettingsOpen}
              onClick={props.onOpenSettings}
            >
              <GearIcon />
            </Tool>
          ) : null}
        </div>
        <div style={{ fontSize: 12, color: colors.neutral600 }}>
          {parts.join(' · ')}
          {parts.length > 0 ? ' · ' : ''}
          <span role="status" data-testid="save-status">
            {t(statusKey(props.status, props.isDirty))}
          </span>
          {props.savedAgo && props.status !== 'conflict' ? ` · ${props.savedAgo}` : ''}
        </div>
      </div>
      <div
        role="group"
        aria-label={t('builder.width.group')}
        style={{ marginLeft: 'auto', display: 'flex' }}
      >
        {DEVICES.map((device) => (
          <Toggle
            key={device.id}
            type="button"
            $isPressed={props.device === device.id}
            aria-pressed={props.device === device.id}
            aria-label={t(`preview.device.${device.id}`, { width: device.width })}
            onClick={() => props.onDevice(device.id)}
          >
            {ICONS[device.id]}
          </Toggle>
        ))}
      </div>
      <label style={{ height: 40, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={props.mode === 'static'}
          onChange={(event) => props.onMode(event.target.checked ? 'static' : 'live')}
        />
        <Typography>{t('preview.static')}</Typography>
      </label>
      <CostMeter resource={props.budget} onMeasureAgain={() => undefined} isCompact />
      <Button
        type="button"
        variant="secondary"
        size="L"
        disabled={props.isReadOnly || props.status === 'saving' || props.status === 'conflict'}
        onClick={props.onSave}
      >
        {t('builder.save')}
      </Button>
    </Bar>
  )
}
