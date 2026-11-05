import { useRef } from 'react'
import styled from 'styled-components'

import { useMessages } from '../../messages'
import {
  GAP_HEIGHT,
  gapsOf,
  nearestGap,
  reportedAt,
  toRect,
  type BlocksReport,
  type Gap,
  type Rect,
} from '../../utils/builder/geometry'
import { DownIcon, DuplicateIcon, UpIcon } from './icons'

/** A block of the page as the overlay names it. */
export interface RenderedBlock {
  /** The block's position among those the frame renders (`data-myc-index`). */
  index: number
  name: string
  /** Why the block has a problem (red outline and the reason in its label), if it does. */
  problem?: string
}

/** A block or an item pointed at. */
export interface Pointed {
  index: number
  item: number | null
}

const Layer = styled.div`
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
`

const Box = styled.div<{ $kind: 'selected' | 'parent' | 'hover' | 'problem' }>`
  position: absolute;
  box-sizing: border-box;
  border-radius: 4px;
  border: ${({ $kind, theme }) =>
    $kind === 'selected'
      ? `2px solid ${theme.colors.primary600}`
      : $kind === 'problem'
        ? `2px solid ${theme.colors.danger600}`
        : `2px dashed ${theme.colors.primary600}`};
  opacity: ${({ $kind }) => ($kind === 'hover' ? 0.6 : 1)};
  transition:
    opacity var(--m-fast) var(--m-ease-out),
    top var(--m-fast) var(--m-ease-out),
    height var(--m-fast) var(--m-ease-out);
  @starting-style {
    opacity: 0;
  }
`

const Tag = styled.div<{ $isProblem: boolean; $isInline?: boolean }>`
  position: ${({ $isInline }) => ($isInline ? 'static' : 'absolute')};
  height: 28px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  border-radius: 4px;
  background: ${({ $isProblem, theme }) => ($isProblem ? theme.colors.danger600 : theme.colors.primary600)};
  color: ${({ theme }) => theme.colors.neutral0};
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: opacity var(--m-fast) var(--m-ease-out);
  @starting-style {
    opacity: 0;
  }
`

/** The tag of a selected item: the parent in blue text on white, and the item as a filled chip. */
const Crumb = styled.div`
  position: absolute;
  height: 28px;
  padding: 0 4px 0 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid ${({ theme }) => theme.colors.primary600};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral0};
  color: ${({ theme }) => theme.colors.primary600};
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: opacity var(--m-fast) var(--m-ease-out);
  @starting-style {
    opacity: 0;
  }
`

const Chip = styled.span`
  padding: 2px 8px;
  border-radius: 3px;
  background: ${({ theme }) => theme.colors.primary600};
  color: ${({ theme }) => theme.colors.neutral0};
`

const Action = styled.button`
  all: unset;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${({ theme }) => theme.colors.neutral0};
  color: ${({ theme }) => theme.colors.primary600};
  border: 1px solid ${({ theme }) => theme.colors.primary600};
  border-radius: 4px;
  cursor: pointer;
  pointer-events: auto;
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.neutral800};
    outline-offset: 1px;
  }
`

const GapBar = styled.div<{ $isTarget: boolean }>`
  position: absolute;
  pointer-events: none;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: ${({ theme }) => theme.colors.primary600};
  opacity: ${({ $isTarget }) => ($isTarget ? 1 : 0.35)};
  color: ${({ theme }) => theme.colors.neutral0};
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
`

const AddHere = styled.button`
  all: unset;
  box-sizing: border-box;
  position: absolute;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed ${({ theme }) => theme.colors.primary600};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral0};
  color: ${({ theme }) => theme.colors.primary600};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  pointer-events: auto;
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.neutral800};
    outline-offset: 1px;
  }
`

interface OverlayProps {
  /** The last `micelio:blocks` of the frame in view, if any. */
  report: BlocksReport | undefined
  /** The blocks the frame renders, by position. */
  rendered: RenderedBlock[]
  selected: Pointed | undefined
  hovered: Pointed | undefined
  /** A block or a palette row is being dragged: the gaps show and accept a drop. */
  isDragging: boolean
  /** The gap under the pointer while dragging. */
  target: Gap | undefined
  onTarget: (gap: Gap | undefined) => void
  onDrop: (gap: Gap) => void
  onMove: (step: -1 | 1) => void
  onDuplicate: () => void
  /** Whether the selected block may be copied: not when the site no longer lists it. */
  canDuplicate: boolean
  /** "+ Add a block here": the editor wants to add at the end of the page. */
  onAddAtEnd: () => void
  isReadOnly: boolean
}

function Outline(props: { rect: Rect; kind: 'selected' | 'parent' | 'hover' | 'problem' }) {
  const { rect } = props
  return (
    <Box
      $kind={props.kind}
      style={{
        top: rect.top - 2,
        left: rect.left - 2,
        width: rect.width + 4,
        height: rect.height + 4,
      }}
    />
  )
}

/**
 * What the admin draws over the frame (the Builder and Block states artboards): the outline, label
 * and actions of the selected block, the dashed outline of the hovered one, the gaps while a block
 * is dragged, and the button at the end of the page.
 *
 * @remarks
 * Every position comes from the boxes the frame reports (`micelio:blocks`); the admin draws no
 * block, only these marks. The layer takes no pointer event except on the actions, the end button
 * and, while dragging, the gaps, so a click on the page reaches the frame.
 */
export function Overlay(props: OverlayProps) {
  const { t } = useMessages()
  const layer = useRef<HTMLDivElement>(null)
  const { report, rendered, selected, hovered } = props
  const scroll = report?.scroll ?? { x: 0, y: 0 }
  const selectedBlock = selected ? reportedAt(report, selected.index) : undefined
  const selectedInfo = selected ? rendered.find(({ index }) => index === selected.index) : undefined
  const hoveredBlock = hovered ? reportedAt(report, hovered.index) : undefined
  const gaps = report ? gapsOf(report) : []
  const last = report?.blocks[report.blocks.length - 1]
  const outlined = (
    pointed: Pointed | undefined,
    block: typeof selectedBlock
  ): Rect | undefined => {
    if (!pointed || !block) return undefined
    const item =
      pointed.item === null ? undefined : block.items.find(({ index }) => index === pointed.item)
    return toRect(item ? item.box : block.box, scroll)
  }
  const selectedRect = outlined(selected, selectedBlock)
  const blockRect = selectedBlock ? toRect(selectedBlock.box, scroll) : undefined
  const hoverRect =
    hovered && !(selected && hovered.index === selected.index && hovered.item === selected.item)
      ? outlined(hovered, hoveredBlock)
      : undefined
  const hoverInfo = hovered ? rendered.find(({ index }) => index === hovered.index) : undefined
  const problems = rendered.flatMap((block) => {
    const reported = reportedAt(report, block.index)
    return block.problem && reported ? [{ block, rect: toRect(reported.box, scroll) }] : []
  })
  const labelTop = (rect: Rect) => Math.max(0, rect.top - 2 - 14)
  // The reason of a selected block goes in the row of its selection label, beside it.
  const selectedProblem =
    selected && selected.item === null
      ? rendered.find(({ index }) => index === selected.index)?.problem
      : undefined
  return (
    <Layer ref={layer} data-testid="builder-overlay">
      {problems.map(({ block, rect }) => (
        <div key={block.index}>
          <Outline rect={rect} kind="problem" />
          {selected?.index === block.index && selected.item === null ? null : (
            <Tag
              $isProblem
              data-testid="problem-label"
              style={{ top: labelTop(rect), left: rect.left + 8 }}
            >
              {block.name} · {block.problem}
            </Tag>
          )}
        </div>
      ))}
      {hoverRect && hoverInfo ? (
        <div data-testid="hover-outline">
          <Outline rect={hoverRect} kind="hover" />
          {selected && selected.item !== null && hovered?.index === selected.index ? null : (
            <Tag
              $isProblem={false}
              style={{ top: labelTop(hoverRect), left: hoverRect.left + 8, opacity: 0.85 }}
            >
              {hoverInfo.name}
            </Tag>
          )}
        </div>
      ) : null}
      {selected && selected.item !== null && blockRect ? (
        <Outline rect={blockRect} kind="hover" />
      ) : null}
      {selectedRect && selectedInfo ? (
        <div data-testid="selected-outline">
          <Outline rect={selectedRect} kind="selected" />
          {selected!.item === null ? (
            <div
              style={{
                position: 'absolute',
                top: labelTop(selectedRect),
                left: selectedRect.left + 8,
                display: 'flex',
                gap: 4,
              }}
            >
              <Tag $isProblem={false} $isInline data-testid="selection-label">
                {t('builder.overlay.label', {
                  name: selectedInfo.name,
                  position: selected!.index + 1,
                  total: rendered.length,
                })}
              </Tag>
              {selectedProblem ? (
                <Tag $isProblem $isInline data-testid="problem-label">
                  {selectedProblem}
                </Tag>
              ) : null}
            </div>
          ) : (
            <Crumb style={{ top: labelTop(selectedRect), left: selectedRect.left + 8 }}>
              <span>{t('builder.overlay.itemParent', { name: selectedInfo.name })}</span>
              <Chip>{t('builder.panel.item', { number: selected!.item + 1 })}</Chip>
            </Crumb>
          )}
          {selected!.item === null && !props.isReadOnly ? (
            <div
              style={{
                position: 'absolute',
                top: labelTop(selectedRect),
                right:
                  Math.max(
                    0,
                    (report?.viewport.width ?? 0) - selectedRect.left - selectedRect.width
                  ) + 8,
                display: 'flex',
                gap: 4,
              }}
            >
              <Action
                type="button"
                aria-label={t('builder.panel.up')}
                disabled={selected!.index === 0}
                onClick={() => props.onMove(-1)}
              >
                <UpIcon />
              </Action>
              <Action
                type="button"
                aria-label={t('builder.panel.down')}
                disabled={selected!.index === rendered.length - 1}
                onClick={() => props.onMove(1)}
              >
                <DownIcon />
              </Action>
              <Action
                type="button"
                aria-label={t('builder.panel.duplicate')}
                disabled={!props.canDuplicate}
                onClick={props.onDuplicate}
              >
                <DuplicateIcon />
              </Action>
            </div>
          ) : null}
        </div>
      ) : null}
      {props.isDragging ? (
        <div
          data-testid="drop-layer"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}
          onDragOver={(event) => {
            event.preventDefault()
            const bounds = layer.current?.getBoundingClientRect()
            props.onTarget(nearestGap(gaps, event.clientY - (bounds?.top ?? 0)))
          }}
          onDragLeave={(event) => {
            // Moving onto a child of the layer is not leaving it.
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              props.onTarget(undefined)
          }}
          onDrop={(event) => {
            event.preventDefault()
            if (props.target) props.onDrop(props.target)
          }}
        >
          {gaps.map((gap) => {
            const isTarget = props.target?.position === gap.position
            const height = isTarget ? 10 : 6
            return (
              <GapBar
                key={gap.position}
                $isTarget={isTarget}
                data-gap={gap.position}
                style={{
                  top: gap.rect.top + (GAP_HEIGHT - height) / 2,
                  left: gap.rect.left,
                  width: gap.rect.width,
                  height,
                }}
              >
                {isTarget ? (
                  <span style={{ position: 'absolute' }}>{t('builder.overlay.drop')}</span>
                ) : null}
              </GapBar>
            )
          })}
        </div>
      ) : null}
      {last && !props.isReadOnly && !props.isDragging ? (
        <AddHere
          type="button"
          style={{
            top: last.box.y + last.box.height - scroll.y + 16,
            left: last.box.x - scroll.x + 16,
            width: Math.max(0, last.box.width - 32),
          }}
          onClick={props.onAddAtEnd}
        >
          {t('builder.overlay.addHere')}
        </AddHere>
      ) : null}
    </Layer>
  )
}
