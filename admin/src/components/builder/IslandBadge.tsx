import styled from 'styled-components'

import { hasMessage, useMessages, type Messages } from '../../messages'
import { weightText, type IslandInfo } from '../../utils/builder/islands'
import { KindIcon } from './icons'

/** What a badge is made of: the kind, then how the island loads and what it weighs, as asked. */
function badgeParts(
  t: Messages['t'],
  island: IslandInfo,
  parts: { trigger?: boolean; weight?: boolean }
): string[] {
  const weight = weightText(island.loadKb)
  return [
    t(`builder.island.kind.${island.kind}`),
    ...(parts.trigger ? [t(`builder.island.trigger.${island.trigger}`)] : []),
    ...(parts.weight ? [t(`builder.island.${weight.unit}`, { value: weight.value })] : []),
  ]
}

/**
 * The text of a badge: the kind, how the island loads and what it weighs, or, for the island shown
 * as its static alternative, what it became (the Island badge artboard).
 *
 * @param parts.alternative - The name of the alternative, for the static badge: `3D → poster`.
 */
export function badgeText(
  t: Messages['t'],
  island: IslandInfo,
  parts: { trigger?: boolean; weight?: boolean; alternative?: string } = {}
): string {
  if (parts.alternative !== undefined) {
    const kind = t(`builder.island.kind.${island.kind}`)
    return t('builder.island.becomes', { kind, alternative: parts.alternative })
  }
  return badgeParts(t, island, parts).join(' · ')
}

/** The name of an alternative's field for a sentence: `poster`, `expected output`; the field's own name when the plugin has none. */
export function alternativeName(t: Messages['t'], field: string | undefined): string {
  if (field === undefined) return ''
  const id = `builder.island.alternative.${field}`
  return hasMessage(id) ? t(id) : field
}

/** The island's colours: the design's `secondary` token, which is reserved for islands. */
const Mark = styled.span<{ $variant: 'box' | 'chip' | 'pill' }>`
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.secondary600};
  background: ${({ $variant, theme }) =>
    $variant === 'pill' ? theme.colors.neutral0 : theme.colors.secondary100};
  border: 1px solid ${({ theme }) => theme.colors.secondary200};
  padding: ${({ $variant }) => ($variant === 'box' ? '0' : '0 8px')};
  width: ${({ $variant }) => ($variant === 'box' ? '28px' : 'auto')};
  height: ${({ $variant }) => ($variant === 'box' ? '28px' : '24px')};
  justify-content: ${({ $variant }) => ($variant === 'box' ? 'center' : 'flex-start')};
`

interface IslandBadgeProps {
  island: IslandInfo
  /**
   * `box` is the icon alone (the palette and the block list), `chip` the icon with its text (the
   * panel) and `pill` the same on white over the page. A pill with an empty `text` is the icon alone
   * in the corner of the preview.
   */
  variant: 'box' | 'chip' | 'pill'
  /** What to write after the kind. */
  parts?: { trigger?: boolean; weight?: boolean; alternative?: string }
  /** Text that replaces the generated one (the selected label names the block). */
  text?: string
}

/**
 * The island badge (the Island badge artboard): a kind icon, and when there is room how it loads and
 * what it weighs. The same mark is the palette, the block list, the preview and the panel.
 *
 * @remarks
 * Blue is the design's `secondary` token and is reserved for islands: nothing else in the builder
 * uses it. An icon alone carries its text as its accessible name.
 */
export function IslandBadge(props: IslandBadgeProps) {
  const { t } = useMessages()
  const { island, variant } = props
  const full = badgeText(t, island, props.parts ?? { trigger: true, weight: true })
  const shown = props.text ?? full
  const isIconOnly = variant === 'box' || shown === ''
  const label = t('builder.island.name', { kind: t(`builder.island.kind.${island.kind}`) })
  // An icon alone names the island, how it loads and what it weighs.
  const described = [
    label,
    ...badgeParts(t, island, { trigger: true, weight: true }).slice(1),
  ].join(' · ')
  return (
    <Mark
      $variant={variant}
      data-testid="island-badge"
      data-kind={island.kind}
      {...(isIconOnly ? { role: 'img', 'aria-label': described, title: described } : {})}
    >
      <KindIcon kind={island.kind} size={variant === 'box' ? 16 : 14} />
      {isIconOnly ? null : <span>{shown}</span>}
    </Mark>
  )
}
