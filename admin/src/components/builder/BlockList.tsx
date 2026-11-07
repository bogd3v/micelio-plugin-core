import { Typography, VisuallyHidden } from '@strapi/design-system'
import { useId } from 'react'
import styled, { useTheme } from 'styled-components'

import { useMessages } from '../../messages'
import type { IslandInfo } from '../../utils/builder/islands'
import { GripIcon } from './icons'
import { IslandBadge } from './IslandBadge'

/** A block of the page as the list shows it. */
export interface ListedBlock {
  key: string
  name: string
  /** The required text the block still lacks, as the reason shown beside its name. */
  hasProblem: boolean
  /** The island the block renders, for its badge. */
  island?: IslandInfo
  /** The page's template fixed the block: it cannot be dragged, moved or removed. */
  isFixed?: boolean
}

const Section = styled.section`
  background: ${({ theme }) => theme.colors.neutral0};
  border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
  border-right: 1px solid ${({ theme }) => theme.colors.neutral150};
  padding: 16px;
`

const List = styled.ol`
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
`

const Row = styled.li<{ $isDragging: boolean; $isCarried: boolean }>`
  display: flex;
  align-items: center;
  opacity: ${({ $isDragging }) => ($isDragging ? 0.5 : 1)};
  /* A block picked up with the keyboard stays in view for as long as it is carried: marked, not faded. */
  outline: ${({ $isCarried, theme }) => ($isCarried ? `2px dashed ${theme.colors.primary600}` : 'none')};
  outline-offset: -2px;
`

const Pick = styled.button<{ $isSelected: boolean }>`
  all: unset;
  box-sizing: border-box;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  color: ${({ $isSelected, theme }) => ($isSelected ? theme.colors.primary600 : theme.colors.neutral800)};
  background: ${({ $isSelected, theme }) => ($isSelected ? theme.colors.primary100 : 'transparent')};
  font-weight: ${({ $isSelected }) => ($isSelected ? 600 : 400)};
  transition: background var(--m-fast) var(--m-ease-out);
  &:hover {
    background: ${({ theme }) => theme.colors.neutral100};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: -2px;
  }
`

const DropLine = styled.li<{ $isOver: boolean }>`
  height: 6px;
  margin: 1px 0;
  border-radius: 3px;
  background: ${({ theme }) => theme.colors.primary600};
  opacity: ${({ $isOver }) => ($isOver ? 1 : 0.35)};
`

interface BlockListProps {
  blocks: ListedBlock[]
  selectedKey: string | undefined
  onSelect: (key: string) => void
  /** The `key` being dragged inside the list or from the page, if any. */
  draggingKey: string | undefined
  /** A block or a palette row is being dragged: the gaps between rows accept a drop. */
  isDragging: boolean
  onDragStart: (key: string) => void
  onDragEnd: () => void
  /** Dropped on the gap before the row at `position` (the length for the end). */
  onDropAt: (position: number) => void
  /** The pointer is over the hit area of the gap at `position`; `undefined` when it left. */
  onHoverGap: (position: number | undefined) => void
  hoveredGap: number | undefined
  /** The block picked up with Space, and the gap it would drop on: said to a screen reader. */
  carrying?: { key: string; from: number }
  isReadOnly: boolean
}

/**
 * The blocks of the page in order (issue #49): select one, drag one to a new place. The selection
 * and the order are the page's, so this list and the preview always agree.
 */
export function BlockList(props: BlockListProps) {
  const { colors } = useTheme()
  const { t } = useMessages()
  const id = useId()
  const { blocks } = props
  const gap = (position: number) => (
    <DropLine
      key={`gap-${position}`}
      aria-hidden="true"
      $isOver={props.hoveredGap === position}
      onDragOver={(event) => {
        event.preventDefault()
        props.onHoverGap(position)
      }}
      onDragLeave={() => props.onHoverGap(undefined)}
      onDrop={(event) => {
        event.preventDefault()
        props.onDropAt(position)
      }}
    />
  )
  return (
    <Section aria-labelledby={`${id}-title`}>
      <Typography variant="sigma" tag="h2" id={`${id}-title`} textColor="neutral600">
        {t('builder.list.title', { count: blocks.length })}
      </Typography>
      <VisuallyHidden>
        <span role="status">
          {props.carrying
            ? t('builder.list.carrying', {
                name: blocks.find(({ key }) => key === props.carrying?.key)?.name ?? '',
                gap: (props.hoveredGap ?? props.carrying.from) + 1,
                total: blocks.length + 1,
              })
            : ''}
        </span>
      </VisuallyHidden>
      {blocks.length === 0 ? (
        <Typography variant="pi" textColor="neutral600" tag="p">
          {t('builder.list.empty')}
        </Typography>
      ) : (
        <List>
          {blocks.flatMap((block, position) => [
            props.isDragging ? gap(position) : null,
            <Row
              key={block.key}
              $isDragging={props.draggingKey === block.key && props.carrying?.key !== block.key}
              $isCarried={props.carrying?.key === block.key}
              draggable={!props.isReadOnly && !block.isFixed}
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-micelio-move', block.key)
                event.dataTransfer.effectAllowed = 'move'
                props.onDragStart(block.key)
              }}
              onDragEnd={props.onDragEnd}
            >
              <Pick
                type="button"
                $isSelected={props.selectedKey === block.key}
                aria-current={props.selectedKey === block.key ? 'true' : undefined}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Space"
                data-block-key={block.key}
                onClick={() => props.onSelect(block.key)}
              >
                <span
                  aria-hidden="true"
                  style={{ color: colors.neutral600, display: 'inline-flex' }}
                >
                  <GripIcon />
                </span>
                <span style={{ flexGrow: 1 }}>{block.name}</span>
                {block.island ? <IslandBadge island={block.island} variant="box" /> : null}
                {block.isFixed ? (
                  <span style={{ fontSize: 11, color: colors.neutral600, fontWeight: 600 }}>
                    {t('builder.list.fixed')}
                  </span>
                ) : null}
                {block.hasProblem ? (
                  <span style={{ fontSize: 11, color: colors.danger700, fontWeight: 600 }}>
                    {t('builder.list.problem')}
                  </span>
                ) : null}
                <span style={{ fontSize: 11, color: colors.neutral600 }}>{position + 1}</span>
              </Pick>
            </Row>,
          ])}
          {props.isDragging ? gap(blocks.length) : null}
        </List>
      )}
    </Section>
  )
}
