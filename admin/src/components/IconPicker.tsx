import { Popover } from '@strapi/design-system'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useIntl } from 'react-intl'
import styled from 'styled-components'

import { useIconEntry, useIcons } from '../hooks/useIcons'
import { useMessages } from '../messages'
import {
  CHIPS_SHOWN,
  PAGE_SIZE,
  isName,
  labelLocale,
  moveInGrid,
  type IconAnswerEntry,
} from '../utils/icons'

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  min-height: 48px;
  padding: 6px 8px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral0};
  &[data-empty='true'] {
    border-style: dashed;
  }
  &[data-invalid='true'] {
    border-color: ${({ theme }) => theme.colors.danger600};
  }
  &:focus-within {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 0;
  }
`

const RowButton = styled.button`
  all: unset;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  &:disabled {
    cursor: default;
  }
`

const Tile = styled.span`
  flex: none;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral100};
  color: ${({ theme }) => theme.colors.neutral800};
  &[data-plus='true'] {
    background: ${({ theme }) => theme.colors.neutral0};
    border: 1px dashed ${({ theme }) => theme.colors.neutral500};
    color: ${({ theme }) => theme.colors.neutral600};
    box-sizing: border-box;
  }
  svg {
    width: 20px;
    height: 20px;
  }
`

const Remove = styled.button`
  all: unset;
  flex: none;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.neutral600};
  &:hover {
    background: ${({ theme }) => theme.colors.neutral100};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
  }
`

const Panel = styled(Popover.Content)`
  box-sizing: border-box;
  width: min(336px, 100vw);
  /* Taller than the room under (or over) the field: the dialog scrolls instead of leaving the screen. */
  max-height: var(--radix-popover-content-available-height);
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral150};
  border-radius: 4px;
  box-shadow: ${({ theme }) => theme.shadows.popupShadow};
`

const Search = styled.input`
  height: 40px;
  width: 100%;
  box-sizing: border-box;
  padding: 0 12px;
  font: inherit;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 0;
  }
`

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const Chip = styled.button`
  all: unset;
  box-sizing: border-box;
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 12px;
  color: ${({ theme }) => theme.colors.neutral800};
  cursor: pointer;
  &[aria-pressed='true'] {
    background: ${({ theme }) => theme.colors.primary100};
    border-color: ${({ theme }) => theme.colors.primary600};
    color: ${({ theme }) => theme.colors.primary700};
    font-weight: 600;
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
  }
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(6, 40px);
  gap: 6px;
  justify-content: space-between;
  max-height: 248px;
  overflow-y: auto;
  padding: 2px;
`

const Glyph = styled.button`
  all: unset;
  box-sizing: border-box;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.neutral800};
  cursor: pointer;
  &:hover {
    background: ${({ theme }) => theme.colors.neutral100};
  }
  &[aria-selected='true'] {
    border: 2px solid ${({ theme }) => theme.colors.primary600};
    background: ${({ theme }) => theme.colors.primary100};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
  svg {
    width: 20px;
    height: 20px;
  }
`

const Foot = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.neutral600};
`

const MoreButton = styled(Chip)`
  align-self: center;
`

/** A glyph of the catalogue: its SVG is the package's own, normalised, never user input. */
const GlyphSvg = (props: { svg: string }) => (
  <span
    aria-hidden="true"
    style={{ display: 'contents' }}
    dangerouslySetInnerHTML={{ __html: props.svg }}
  />
)

const PlusIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const CloseIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

/** What the picker takes: a value and how to change it, as a field of a form. */
export interface IconPickerProps {
  /** An `id` for the field's button. */
  id?: string
  /** The field's label. */
  label: string
  /** The stored name, as written (an alias is kept), or `null` for none. */
  value: string | null
  /** The editor's choice: a name of the catalogue, or `null` for none. Never rewrites what is stored. */
  onChange: (value: string | null) => void
  /** The slug of the page's site: the picker shows the glyphs that site resolves. */
  site?: string
  /** What the field says under it; the default is the catalogue hint. */
  hint?: string
  /** What is wrong with the value, as the host's form says it. */
  error?: string
  required?: boolean
  disabled?: boolean
}

/**
 * The picker of an icon of the catalogue (ADR-0021, section 5): the field (the glyph, its label and
 * its name, or the empty state) and, under it, a dialog with a search, the categories and a listbox
 * of glyphs.
 *
 * @remarks
 * The search matches the name, the label in either language, the category and the aliases, on the
 * server (`GET /micelio/icons`). Keys: `Enter` on the field opens the dialog on its search, `↓`
 * enters the grid, the arrows move, `Enter` picks, `Esc` closes and keeps the old icon.
 */
export function IconPicker(props: IconPickerProps) {
  const { t } = useMessages()
  const { locale } = useIntl()
  const language = labelLocale(locale)
  const reactId = useId()
  const id = props.id ?? `${reactId}-icon`
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>()
  const [isAllShown, setIsAllShown] = useState(false)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [active, setActive] = useState(0)
  const rowButton = useRef<HTMLButtonElement>(null)
  const row = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const options = useRef<(HTMLButtonElement | null)[]>([])
  const value = isName(props.value) ? props.value : null
  const current = useIconEntry(value, props.site, language)
  const resource = useIcons(
    { site: props.site, q: query, category, locale: language, limit },
    isOpen
  )
  const answer =
    resource.kind === 'ready'
      ? resource.answer
      : resource.kind === 'loading'
        ? resource.previous
        : undefined
  const entries = answer?.entries ?? []
  const hintId = `${id}-hint`

  // A new query starts at the top of the list; the tab stop goes to the picked icon, else the first.
  useEffect(() => {
    const picked = entries.findIndex((entry) => entry.name === current?.name)
    setActive(picked >= 0 ? picked : 0)
  }, [answer])

  const open = (next: boolean) => {
    setIsOpen(next)
    if (next) {
      setQuery('')
      setCategory(undefined)
      setIsAllShown(false)
      setLimit(PAGE_SIZE)
    }
  }
  const pick = (entry: IconAnswerEntry) => {
    props.onChange(entry.name)
    open(false)
  }
  const focusOption = (index: number) => {
    setActive(index)
    options.current[index]?.focus()
    options.current[index]?.scrollIntoView?.({ block: 'nearest' })
  }
  const onGridKey = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const next = moveInGrid(event.key, index, entries.length)
    if (next === undefined) return
    event.preventDefault()
    if (next < 0) search.current?.focus()
    else focusOption(next)
  }

  const categories = answer?.categories ?? []
  const chips = isAllShown ? categories : categories.slice(0, CHIPS_SHOWN)
  const number = new Intl.NumberFormat(locale)
  const isEmpty = value === null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Popover.Root open={isOpen} onOpenChange={open}>
        <Popover.Anchor>
          <span
            id={`${id}-label`}
            style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}
          >
            {props.label}
            {props.required ? <span aria-hidden="true"> *</span> : null}
          </span>
          <Row ref={row} data-empty={isEmpty} data-invalid={props.error ? 'true' : undefined}>
            <RowButton
              ref={rowButton}
              id={id}
              type="button"
              disabled={props.disabled}
              aria-haspopup="dialog"
              aria-expanded={isOpen}
              aria-labelledby={`${id}-label ${id}-text`}
              aria-describedby={props.error ? `${hintId} ${id}-error` : hintId}
              onClick={() => open(!isOpen)}
            >
              <Tile data-plus={isEmpty}>
                {isEmpty ? <PlusIcon /> : current ? <GlyphSvg svg={current.glyph} /> : null}
              </Tile>
              <span
                id={`${id}-text`}
                style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}
              >
                {isEmpty ? (
                  <span style={{ fontSize: 14 }}>{t('icon.field.choose')}</span>
                ) : (
                  <>
                    <span style={{ fontSize: 14 }}>{current?.label ?? value}</span>
                    <code style={{ fontSize: 12 }}>{value}</code>
                  </>
                )}
              </span>
            </RowButton>
            {isEmpty ? null : (
              <Remove
                type="button"
                aria-label={t('icon.field.remove')}
                disabled={props.disabled}
                onClick={() => {
                  props.onChange(null)
                  rowButton.current?.focus()
                }}
              >
                <CloseIcon />
              </Remove>
            )}
          </Row>
        </Popover.Anchor>
        <Panel
          aria-label={t('icon.picker.title')}
          // `Esc` closes here too: Radix listens on the document once its layer is mounted, and a key
          // pressed as the dialog opens (focus is moved before that) reached no one and left it open.
          onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            open(false)
          }}
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault()
            search.current?.focus()
          }}
          onInteractOutside={(event: Event) => {
            // The field's own button toggles the dialog: closing here as well would reopen it.
            if (event.target instanceof Node && row.current?.contains(event.target)) {
              event.preventDefault()
            }
          }}
          onCloseAutoFocus={(event: Event) => {
            event.preventDefault()
            rowButton.current?.focus()
          }}
        >
          <Search
            ref={search}
            type="search"
            value={query}
            aria-label={t('icon.picker.search')}
            placeholder={t('icon.picker.searchPlaceholder')}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value)
              setLimit(PAGE_SIZE)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && entries.length > 0) {
                event.preventDefault()
                focusOption(Math.min(active, entries.length - 1))
              }
            }}
          />
          <Chips role="group" aria-label={t('icon.picker.categories')}>
            <Chip
              type="button"
              aria-pressed={category === undefined}
              onClick={() => {
                setCategory(undefined)
                setLimit(PAGE_SIZE)
              }}
            >
              {t('icon.picker.all')}
            </Chip>
            {chips.map((chip) => (
              <Chip
                key={chip.name}
                type="button"
                aria-pressed={category === chip.name}
                onClick={() => {
                  setCategory(chip.name)
                  setLimit(PAGE_SIZE)
                }}
              >
                {chip.label}
              </Chip>
            ))}
            {categories.length > CHIPS_SHOWN ? (
              <Chip
                type="button"
                aria-expanded={isAllShown}
                onClick={() => setIsAllShown(!isAllShown)}
              >
                {isAllShown ? t('icon.picker.fewer') : t('icon.picker.more')}
              </Chip>
            ) : null}
          </Chips>
          {resource.kind === 'error' ? (
            <p role="alert" style={{ margin: 0, fontSize: 13 }}>
              {t('icon.picker.error')}
            </p>
          ) : !answer ? (
            <p role="status" style={{ margin: 0, fontSize: 13 }}>
              {t('icon.picker.loading')}
            </p>
          ) : entries.length === 0 ? (
            <p role="status" style={{ margin: 0, fontSize: 13 }}>
              {t('icon.picker.noMatch')}
            </p>
          ) : (
            <Grid role="listbox" aria-label={t('icon.picker.list')}>
              {entries.map((entry, index) => (
                <Glyph
                  key={entry.name}
                  ref={(element) => {
                    options.current[index] = element
                  }}
                  type="button"
                  role="option"
                  aria-selected={entry.name === current?.name || entry.name === value}
                  aria-label={entry.label}
                  title={entry.name}
                  tabIndex={index === active ? 0 : -1}
                  onClick={() => pick(entry)}
                  onKeyDown={(event) => onGridKey(event, index)}
                >
                  <GlyphSvg svg={entry.glyph} />
                </Glyph>
              ))}
            </Grid>
          )}
          {answer && answer.count > entries.length ? (
            <MoreButton type="button" onClick={() => setLimit(limit + PAGE_SIZE)}>
              {t('icon.picker.showMore')}
            </MoreButton>
          ) : null}
          <Foot>
            <span aria-live="polite">
              {answer
                ? t('icon.picker.count', {
                    count: number.format(answer.count),
                    total: number.format(answer.total),
                  })
                : ''}
            </span>
            <span>{answer ? t('icon.picker.version', { version: answer.version }) : ''}</span>
          </Foot>
        </Panel>
      </Popover.Root>
      <span id={hintId} style={{ fontSize: 12 }}>
        {props.hint ?? t('icon.field.hint')}
      </span>
      {props.error ? (
        <span id={`${id}-error`} role="alert" style={{ fontSize: 12 }}>
          {props.error}
        </span>
      ) : null}
    </div>
  )
}
