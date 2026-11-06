import { Typography } from '@strapi/design-system'
import { useId, type RefObject } from 'react'
import styled, { useTheme, type DefaultTheme } from 'styled-components'

import { useMessages } from '../../messages'
import { setGhost } from '../../utils/builder/ghost'
import { highlight, type PaletteGroup, type PaletteRow } from '../../utils/builder/palette'
import { BlockGlyph } from './icons'
import { IslandBadge } from './IslandBadge'
import { islandOf, weightText } from '../../utils/builder/islands'

const Aside = styled.aside`
  flex: 0 1 264px;
  min-width: 220px;
  background: ${({ theme }) => theme.colors.neutral0};
  border-right: 1px solid ${({ theme }) => theme.colors.neutral150};
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const Search = styled.input<{ $isActive: boolean }>`
  height: 36px;
  width: 100%;
  box-sizing: border-box;
  padding: 0 10px;
  font: inherit;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid
    ${({ $isActive, theme }) => ($isActive ? theme.colors.primary600 : theme.colors.neutral200)};
  border-radius: 4px;
  box-shadow: ${({ $isActive, theme }) => ($isActive ? `0 0 0 2px ${theme.colors.primary200}` : 'none')};
  transition:
    border-color var(--m-fast) var(--m-ease-out),
    box-shadow var(--m-fast) var(--m-ease-out);
`

const GroupLabel = styled.h3`
  margin: 8px 0 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.neutral600};
`

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
`

const Item = styled.li<{ $isDragging: boolean }>`
  opacity: ${({ $isDragging }) => ($isDragging ? 0.5 : 1)};
`

const RowButton = styled.button<{ $state: PaletteRow['state'] }>`
  all: unset;
  box-sizing: border-box;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 4px;
  font-size: 13px;
  color: ${({ $state, theme }) => ($state === 'notAllowed' ? theme.colors.neutral400 : theme.colors.neutral800)};
  cursor: ${({ $state }) => ($state === 'notAllowed' ? 'not-allowed' : 'grab')};
  transition: background var(--m-fast) var(--m-ease-out);
  &:hover:not([aria-disabled='true']) {
    background: ${({ theme }) => theme.colors.neutral100};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: -2px;
    background: ${({ theme }) => theme.colors.primary100};
  }
`

const iconBox = (c: DefaultTheme['colors']) => ({
  ok: `background:${c.neutral100};border:1px solid ${c.neutral200};`,
  overBudget: `background:${c.danger100};border:1px solid ${c.danger200};color:${c.danger700};`,
  notAllowed: `background:${c.neutral100};border:1px dashed ${c.neutral200};color:${c.neutral400};`,
})

const IconBox = styled.span<{ $kind: keyof ReturnType<typeof iconBox> }>`
  flex: none;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  ${({ $kind, theme }) => iconBox(theme.colors)[$kind]}
`

const Cost = styled.span<{ $color: string; $weight: number }>`
  font-size: 11px;
  font-weight: ${({ $weight }) => $weight};
  color: ${({ $color }) => $color};
  white-space: nowrap;
`

const Note = styled.p`
  margin: 0 0 4px;
  padding-left: 46px;
  font-size: 11px;
  color: ${({ theme }) => theme.colors.neutral600};
`

const Empty = styled.div`
  padding: 14px;
  font-size: 12px;
  background: ${({ theme }) => theme.colors.neutral100};
  border-radius: 4px;
`

const Foot = styled.div`
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
  font-size: 11px;
  color: ${({ theme }) => theme.colors.neutral600};
  kbd {
    font: inherit;
    padding: 0 4px;
    border: 1px solid ${({ theme }) => theme.colors.neutral200};
    border-radius: 3px;
    background: ${({ theme }) => theme.colors.neutral100};
  }
`

interface PaletteProps {
  groups: PaletteGroup[]
  /** The page type's name, shown at the head. */
  pageTypeName: string
  /** What the page's budget has left in kB, when measured. */
  leftKb: number | undefined
  search: string
  onSearch: (search: string) => void
  /** How many blocks the palette holds in all, for the placeholder. */
  total: number
  /** How many rows match the search. */
  matched: number
  inputRef: RefObject<HTMLInputElement>
  /** The `key` of the row being dragged. */
  draggingId: string | undefined
  onInsert: (row: PaletteRow) => void
  onDragStart: (row: PaletteRow) => void
  onDragEnd: () => void
  /** The editor may not edit this page: the rows do nothing. */
  isReadOnly: boolean
}

function Name({ name, search }: { name: string; search: string }) {
  const { before, match, after } = highlight(name, search)
  return (
    <span style={{ flexGrow: 1 }}>
      {before}
      {match ? <b>{match}</b> : null}
      {after}
    </span>
  )
}

/**
 * The block palette (the Palette states artboard): the site's blocks for the page type, in groups,
 * with their cost and an island badge. A row inserts its block after the selection (click, or Enter
 * on the focused button) or is dragged into a gap of the page.
 */
export function Palette(props: PaletteProps) {
  const { colors } = useTheme()
  const { t } = useMessages()
  const id = useId()
  const { groups, search, onSearch, matched, total } = props
  const isSearching = search.trim() !== ''
  return (
    <Aside aria-label={t('builder.palette.label')}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography variant="sigma" tag="h2" textColor="neutral600">
          {t('builder.palette.title')}
        </Typography>
        <Typography variant="pi" textColor="neutral600">
          {t('builder.palette.pageType', { type: props.pageTypeName })}
        </Typography>
      </div>
      <label htmlFor={`${id}-search`} style={visuallyHidden}>
        {t('builder.palette.search')}
      </label>
      <Search
        id={`${id}-search`}
        ref={props.inputRef}
        type="search"
        $isActive={isSearching}
        value={search}
        placeholder={t('builder.palette.placeholder', { count: total })}
        onChange={(event) => onSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onSearch('')
        }}
      />
      {isSearching ? (
        <Typography variant="pi" textColor="neutral600" role="status">
          {t('builder.palette.matches', { matched, total, search: search.trim() })}{' '}
          <button
            type="button"
            onClick={() => onSearch('')}
            style={{
              all: 'unset',
              cursor: 'pointer',
              color: colors.primary600,
              textDecoration: 'underline',
            }}
          >
            {t('builder.palette.clear')}
          </button>
        </Typography>
      ) : null}
      {isSearching && matched === 0 ? (
        <Empty role="status">
          <p style={{ margin: 0 }}>{t('builder.palette.empty', { search: search.trim() })}</p>
          <p style={{ margin: '4px 0 0', color: colors.neutral600 }}>
            {t('builder.palette.emptyHint')}
          </p>
        </Empty>
      ) : null}
      {groups
        .filter((group) => group.rows.length > 0)
        .map((group) => (
          <section key={group.id} aria-labelledby={`${id}-${group.id}`}>
            <GroupLabel id={`${id}-${group.id}`}>
              {t(`builder.palette.group.${group.id}`)}
            </GroupLabel>
            <List>
              {group.rows.map((row) => {
                const rowId = `${id}-${group.id}-${row.entry.id}`
                const kind = row.state === 'ok' ? 'ok' : row.state
                const costColor =
                  row.state === 'overBudget'
                    ? colors.danger700
                    : row.isIsland
                      ? colors.secondary600
                      : colors.neutral600
                const isDisabled = row.state === 'notAllowed'
                const island = islandOf(row.entry)
                // An island shows what it loads once used; the page's own weight is the budget's.
                const costText = (item: PaletteRow) => {
                  if (!island) return t('builder.palette.cost', { kb: item.costKb })
                  const weight = weightText(island.loadKb)
                  return t('builder.palette.costIsland', {
                    weight: t(`builder.island.${weight.unit}`, { value: weight.value }),
                  })
                }
                return (
                  <Item
                    key={row.entry.id}
                    $isDragging={props.draggingId === row.entry.id}
                    draggable={!isDisabled && !props.isReadOnly}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('application/x-micelio-block', row.entry.id)
                      event.dataTransfer.effectAllowed = 'copy'
                      setGhost(event.dataTransfer, row.name, costText(row), {
                        card: colors.neutral0,
                        text: colors.neutral800,
                        muted: colors.neutral600,
                        accent: colors.primary600,
                        tint: colors.primary100,
                      })
                      props.onDragStart(row)
                    }}
                    onDragEnd={props.onDragEnd}
                  >
                    <RowButton
                      type="button"
                      $state={row.state}
                      aria-disabled={isDisabled || props.isReadOnly}
                      aria-describedby={row.state === 'ok' ? undefined : `${rowId}-note`}
                      data-block={row.entry.id}
                      onClick={() => {
                        if (!isDisabled && !props.isReadOnly) props.onInsert(row)
                      }}
                    >
                      {island ? (
                        <IslandBadge island={island} variant="box" />
                      ) : (
                        <IconBox $kind={kind}>
                          <BlockGlyph isIsland={false} />
                        </IconBox>
                      )}
                      <Name name={row.name} search={search} />
                      <Cost $color={costColor} $weight={row.state === 'overBudget' ? 600 : 400}>
                        {costText(row)}
                      </Cost>
                    </RowButton>
                    {row.state === 'notAllowed' ? (
                      <Note id={`${rowId}-note`}>
                        {t('builder.palette.notAllowed', { type: props.pageTypeName })}
                      </Note>
                    ) : null}
                    {row.state === 'overBudget' ? (
                      <Note id={`${rowId}-note`}>
                        {t('builder.palette.overBudget', { left: props.leftKb ?? 0 })}
                      </Note>
                    ) : null}
                  </Item>
                )
              })}
            </List>
          </section>
        ))}
      <Foot>
        <p style={{ margin: '0 0 8px', fontSize: 12 }}>
          {t('builder.palette.help.before')} <kbd>{t('builder.palette.help.key')}</kbd>{' '}
          {t('builder.palette.help.after')}
        </p>
        <div>
          <kbd>⌥↑</kbd> <kbd>⌥↓</kbd> {t('builder.palette.keys.move')}
        </div>
      </Foot>
    </Aside>
  )
}

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const
