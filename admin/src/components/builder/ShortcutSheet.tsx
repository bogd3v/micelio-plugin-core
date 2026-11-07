import { Modal, Typography } from '@strapi/design-system'
import { useEffect, useRef } from 'react'
import styled from 'styled-components'

import { useMessages } from '../../messages'
import { SHORTCUTS, keyCaps, type Chord, type GroupId, type Shortcut } from '../../shortcuts'

const Columns = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 0 32px;
`

const Column = styled.div`
  min-width: 0;
`

const Group = styled.section`
  margin-bottom: 24px;
`

const Row = styled.li`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 0;
  font-size: 14px;
`

const Keys = styled.span`
  display: inline-flex;
  flex-shrink: 0;
  white-space: nowrap;
  justify-content: flex-end;
  gap: 4px;
`

const Cap = styled.kbd`
  min-width: 24px;
  box-sizing: border-box;
  padding: 2px 6px;
  text-align: center;
  font: inherit;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral100};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
`

const Rules = styled.p`
  margin: 0;
  padding: 12px 16px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.neutral600};
  background: ${({ theme }) => theme.colors.neutral100};
  border-radius: 4px;
`

/** Whether the page runs on macOS, where ⌘ is the modifier the sheet shows. */
const isMacPlatform = (): boolean => /Mac|iPhone|iPad/.test(navigator.platform)

/** The keys a row shows: each, or for a range (`1 … 9`) its first and its last. */
const ends = (shortcut: Shortcut): readonly Chord[] =>
  shortcut.isRange ? [shortcut.keys[0]!, shortcut.keys[shortcut.keys.length - 1]!] : shortcut.keys

/** One key of a row: the modifiers and the key, each on its own cap, as the platform writes them. */
function Press({ chord, isMac }: { chord: Chord; isMac: boolean }) {
  return <Cap>{keyCaps(chord, isMac).join(isMac ? '' : '+')}</Cap>
}

/** The groups in each of the two columns, as the Shortcuts artboard sets them. */
const COLUMNS: readonly (readonly GroupId[])[] = [
  ['selecting', 'options', 'page'],
  ['composing', 'preview'],
]

/**
 * The sheet of keyboard shortcuts (the Shortcuts artboard): every action of `SHORTCUTS`, by group,
 * with its keys in the symbols of the platform. It renders from the table the keyboard runs on, so
 * it lists what the page does and nothing else.
 */
export function ShortcutSheet(props: { onClose: () => void }) {
  const { t } = useMessages()
  // Focus goes back to where the sheet was opened from, a key or a link of the palette.
  const opener = useRef(document.activeElement)
  const isMac = isMacPlatform()
  // The page unmounts the sheet at once, so the dialog's own return of focus can come late or not
  // at all: give it back here too.
  useEffect(
    () => () => {
      const from = opener.current
      if (from instanceof HTMLElement) setTimeout(() => from.focus(), 0)
    },
    []
  )
  return (
    <Modal.Root open onOpenChange={(isOpen: boolean) => (isOpen ? undefined : props.onClose())}>
      <Modal.Content
        style={{ width: 'min(720px, 100vw)' }}
        onCloseAutoFocus={(event: Event) => {
          event.preventDefault()
          if (opener.current instanceof HTMLElement) opener.current.focus()
        }}
      >
        <Modal.Header closeLabel={t('shortcuts.close')}>
          <Modal.Title>{t('shortcuts.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
          <Typography tag="p" textColor="neutral600" style={{ marginBottom: 16 }}>
            {t('shortcuts.subtitle')}
          </Typography>
          <Columns>
            {COLUMNS.map((groups, column) => (
              <Column key={column}>
                {groups.map((group) => (
                  <Group key={group} aria-labelledby={`shortcuts-${group}`}>
                    <Typography
                      variant="sigma"
                      tag="h2"
                      id={`shortcuts-${group}`}
                      textColor="neutral600"
                    >
                      {t(`shortcuts.group.${group}`)}
                    </Typography>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                        <Row key={shortcut.id} data-shortcut={shortcut.id}>
                          <span>{t(`shortcuts.${shortcut.id}`)}</span>
                          <Keys>
                            {ends(shortcut).map((chord, index) => (
                              <span key={index}>
                                {index === 1 && 'isRange' in shortcut ? '… ' : ''}
                                <Press chord={chord} isMac={isMac} />
                              </span>
                            ))}
                          </Keys>
                        </Row>
                      ))}
                    </ul>
                  </Group>
                ))}
                {column === COLUMNS.length - 1 ? (
                  <Rules>
                    <strong>{t('shortcuts.rulesLabel')}</strong> {t('shortcuts.rules')}
                  </Rules>
                ) : null}
              </Column>
            ))}
          </Columns>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  )
}
