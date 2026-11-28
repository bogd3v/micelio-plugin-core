import { NavLink } from 'react-router-dom'
import styled from 'styled-components'

import type { ContrastUnchecked } from '../../hooks/useContrast'
import type { CustomizeValues } from '../../utils/customize'

/** The customizer's top bar, as the builder's. */
export const Bar = styled.header`
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

/** The customizer's Close: a 40 px bordered link with the chevron, as the artboard's back button. */
export const Close = styled(NavLink)`
  width: 40px;
  height: 40px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  background: ${({ theme }) => theme.colors.neutral0};
  color: ${({ theme }) => theme.colors.neutral600};
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
`

/** The column of the accent and its matrix, 360 px as the artboard's. */
export const Aside = styled.aside`
  flex: 0 1 360px;
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
  background: ${({ theme }) => theme.colors.neutral0};
  border-right: 1px solid ${({ theme }) => theme.colors.neutral150};
`

/** The clock before the live line, as the artboard draws it. */
export const Clock = styled.svg`
  flex: none;
  fill: none;
  stroke: ${({ theme }) => theme.colors.neutral600};
  stroke-width: 2;
`

/**
 * Why the customizer shows no frame: the frame previews the page the contrast check found, with a
 * token of its own, so a reason of the check's is the frame's too (no permission to preview, no page
 * to read, the token route's limit, a site with no `url`).
 */
export function noFrameText(
  reason: ContrastUnchecked,
  t: (id: string, values?: Record<string, string | number>) => string
): string {
  switch (reason) {
    case 'forbidden':
      return t('preview.error.forbidden')
    case 'noPage':
      return t('customizer.live.noPage')
    case 'busy':
      return t('preview.error.busy')
    case 'unavailable':
      return t('preview.error.unavailable')
    default:
      return t('preview.error.failed')
  }
}

/** The tab the customizer opens on: the site's default mode when the theme lists it, else the first. */
export function defaultTab(rows: { mode: string }[], saved: CustomizeValues): string | undefined {
  return rows.find(({ mode }) => mode === saved.defaultMode)?.mode ?? rows[0]?.mode
}
