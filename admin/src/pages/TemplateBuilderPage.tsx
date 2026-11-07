import { Box, Button, Typography } from '@strapi/design-system'
import { Page, useNotification } from '@strapi/strapi/admin'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { NavLink, useParams } from 'react-router-dom'
import styled, { useTheme } from 'styled-components'

import { BlockList } from '../components/builder/BlockList'
import { BlockPanel } from '../components/builder/BlockPanel'
import { Centre, Columns, Shell, Toast } from '../components/builder/layout'
import { Motion } from '../components/builder/Motion'
import { Palette } from '../components/builder/Palette'
import { ChevronLeftIcon } from '../components/builder/icons'
import { Notice } from '../components/Notice'
import { useBlockLookup } from '../hooks/useBlockLookup'
import { useBuilderCatalogue, type BuilderCatalogue } from '../hooks/useBuilderCatalogue'
import { useBuilderEdits } from '../hooks/useBuilderEdits'
import { useBuilderShortcuts } from '../hooks/useBuilderShortcuts'
import { useTemplateDocument } from '../hooks/useTemplateDocument'
import { useMessages } from '../messages'
import { TEMPLATES_MANAGE_PERMISSION } from '../permissions'
import { PLUGIN_ID } from '../pluginId'
import { islandOf } from '../utils/builder/islands'
import type { BuilderBlock } from '../utils/builder/model'
import {
  costKbOf,
  groupRows,
  matches,
  nameOf,
  stateOf,
  type PaletteRow,
} from '../utils/builder/palette'

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
  &:hover {
    background: ${({ theme }) => theme.colors.neutral100};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
`

const Rules = styled.section`
  background: ${({ theme }) => theme.colors.neutral0};
  border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
  border-right: 1px solid ${({ theme }) => theme.colors.neutral150};
  padding: 16px;
  display: grid;
  gap: 8px;
`

/**
 * Edit a template (issue #55, the Page templates artboard): the builder without the preview frame,
 * on the blocks of one template.
 *
 * @remarks
 * A template is not a page the frontend can render: the frontend renders only the content types it
 * lists (`PREVIEW_CONTENT_TYPES`), so the frame is left out and a notice says why. Each block keeps
 * its options and its text as on a page, and says whether a page made from the template keeps its
 * sample text or starts cleared, and whether it is fixed. Saving is on purpose and makes the next
 * version of the template, with what changed in its history; pages made from it are offered the
 * changes and never get them by themselves.
 */
export default function TemplateBuilderPage() {
  return (
    <Page.Protect permissions={[TEMPLATES_MANAGE_PERMISSION]}>
      <TemplateBuilder />
    </Page.Protect>
  )
}

const noFrame = { current: null }

function TemplateBuilder() {
  const { colors } = useTheme()
  const { t } = useMessages()
  const { locale: language } = useIntl()
  const { id = '' } = useParams()
  const { toggleNotification } = useNotification()
  const [catalogue, setCatalogue] = useState<BuilderCatalogue>()
  const { byComponent, entryOf, fieldsFor, itemFieldsFor } = useBlockLookup(catalogue)
  const state = useTemplateDocument(id, (component) => byComponent.get(component)?.id)
  const template = state.resource.kind === 'ready' ? state.resource.template : undefined
  const catalogueResource = useBuilderCatalogue(undefined, template?.site)
  useEffect(() => {
    setCatalogue(catalogueResource.kind === 'ready' ? catalogueResource.catalogue : undefined)
  }, [catalogueResource])

  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string>()
  const [item, setItem] = useState<{ field: string; index: number }>()
  const [recent, setRecent] = useState<string[]>([])
  const searchInput = useRef<HTMLInputElement>(null)
  const { blocks } = state
  const selectedBlock = blocks.find((block) => block.key === selectedKey)
  const selection = selectedKey ? { key: selectedKey, item } : undefined
  const select = (
    next: { key: string; item: { field: string; index: number } | undefined } | undefined
  ) => {
    setSelectedKey(next?.key)
    setItem(next?.item)
  }
  const isReadOnly = template?.origin === 'theme'

  const edits = useBuilderEdits({
    state,
    catalogue,
    language,
    selection,
    select,
    selectedBlock,
    fieldsFor,
    addressOf: () => undefined,
    renderedAt: () => blocks.map(({ key, component }) => ({ key, component })),
    reportVersion: undefined,
    frameVersion: undefined,
    frame: noFrame,
    recent,
    setRecent,
  })
  const {
    drag,
    setDrag,
    listGap,
    setListGap,
    toast,
    insertEntry,
    afterSelection,
    dropAtPosition,
    endDrag,
    move,
    copy,
    remove,
    setValues,
    setItem: setItemValues,
    addItem,
    goBack,
  } = edits

  // The editor has the keys of its own controls and no others: moving (the arrows and Space's
  // carry), duplicating, removing.
  const { carrying } = useBuilderShortcuts({
    blocks,
    selection,
    select,
    itemFieldsOf: () => [],
    edits,
    isReadOnly,
    canDuplicate: selectedBlock !== undefined && entryOf(selectedBlock) !== undefined,
    save: () => undefined,
    undo: () => false,
    redo: () => false,
    setDevice: () => undefined,
    setMode: () => undefined,
    openSettings: undefined,
    openSheet: () => undefined,
    requestReview: undefined,
    openPage: () => undefined,
    backToEntry: () => undefined,
    focusSearch: () => undefined,
    only: ['move', 'carry', 'parent', 'edit'],
  })

  const pageType = template?.pageTypes[0] ?? 'standard'
  const rows = useMemo<PaletteRow[]>(
    () =>
      (catalogue?.entries ?? []).map((entry) => ({
        entry,
        name: nameOf(entry, language),
        costKb: costKbOf(entry),
        isIsland: entry.cost.island !== null,
        state: stateOf(entry, pageType, undefined),
      })),
    [catalogue, language, pageType]
  )
  const groups = groupRows(rows, search, recent)
  const nameFor = (block: BuilderBlock): string => {
    const entry = entryOf(block)
    return entry ? nameOf(entry, language) : block.component
  }

  // A page you leave unsaved is lost: the browser asks first.
  useEffect(() => {
    if (!state.isDirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [state.isDirty])

  if (state.resource.kind === 'error') {
    return (
      <Page.Main>
        <Page.Title>{t('template.edit.title')}</Page.Title>
        <Box padding={6}>
          <Typography role="alert">
            {t(state.resource.status === 404 ? 'template.edit.missing' : 'template.edit.error')}
          </Typography>
        </Box>
      </Page.Main>
    )
  }
  if (catalogueResource.kind === 'error') {
    return (
      <Page.Main>
        <Page.Title>{t('template.edit.title')}</Page.Title>
        <Box padding={6}>
          <Typography role="alert">{t(`builder.error.${catalogueResource.reason}`)}</Typography>
        </Box>
      </Page.Main>
    )
  }

  const selectedEntry = selectedBlock ? entryOf(selectedBlock) : undefined
  const position = selectedBlock ? blocks.indexOf(selectedBlock) : -1
  const rule = selectedBlock ? state.ruleOf(selectedBlock.key) : undefined
  const name = template?.name ?? ''
  const statusText =
    state.status === 'saving'
      ? t('template.edit.saving')
      : state.status === 'saved'
        ? t('template.edit.saved', { version: template?.version ?? 0 })
        : state.status === 'conflict'
          ? t('template.edit.conflict')
          : state.status === 'failed'
            ? t('template.edit.failed', { detail: state.detail ?? '' })
            : state.isDirty
              ? t('template.edit.dirty')
              : t('template.edit.idle')

  return (
    <Motion>
      <Page.Main>
        <Page.Title>{t('template.edit.page', { name })}</Page.Title>
        <Shell>
          <Bar>
            <Back to={`/plugins/${PLUGIN_ID}/templates`} aria-label={t('template.edit.back')}>
              <ChevronLeftIcon />
            </Back>
            <div>
              <Typography tag="h1" variant="delta" fontWeight="bold">
                {name}
              </Typography>
              <div style={{ fontSize: 12, color: colors.neutral600 }}>
                {t('template.edit.version', { version: template?.version ?? 0 })} ·{' '}
                <span
                  role={state.status === 'failed' ? 'alert' : 'status'}
                  data-testid="save-status"
                >
                  {statusText}
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="L"
              style={{ marginLeft: 'auto' }}
              disabled={isReadOnly || !state.isDirty || state.status === 'saving'}
              onClick={() => {
                void state.save().then((isSaved) => {
                  if (!isSaved) return
                  toggleNotification({
                    type: 'success',
                    message: t('template.edit.notified', { name }),
                  })
                })
              }}
            >
              {t('template.edit.save', { version: (template?.version ?? 0) + 1 })}
            </Button>
          </Bar>
          <Notice
            role="status"
            title={t('template.edit.noFrame.title')}
            text={t('template.edit.noFrame.body')}
          />
          {isReadOnly ? <Notice role="status" text={t('template.edit.theme')} /> : null}
          {state.status === 'conflict' ? (
            <Notice role="alert" title={t('template.edit.conflict')} text={state.detail ?? ''}>
              <Button type="button" variant="secondary" onClick={state.reload}>
                {t('builder.conflict.theirs')}
              </Button>
            </Notice>
          ) : null}
          <Columns>
            <div
              style={{
                flex: '0 1 264px',
                minWidth: 220,
                display: 'flex',
                flexDirection: 'column',
                background: colors.neutral0,
              }}
            >
              <Palette
                groups={groups}
                pageTypeName={pageType}
                leftKb={undefined}
                search={search}
                onSearch={setSearch}
                total={rows.length}
                matched={rows.filter((row) => matches(row, search)).length}
                inputRef={searchInput}
                draggingId={drag?.kind === 'new' ? drag.id : undefined}
                onInsert={(row) => insertEntry(row.entry, afterSelection())}
                onDragStart={(row) => setDrag({ kind: 'new', id: row.entry.id, name: row.name })}
                onDragEnd={endDrag}
                isReadOnly={isReadOnly}
              />
              <BlockList
                blocks={blocks.map((block) => ({
                  key: block.key,
                  name: nameFor(block),
                  hasProblem: false,
                  island: islandOf(entryOf(block)),
                  isFixed: state.ruleOf(block.key).fixed,
                }))}
                selectedKey={selectedKey}
                onSelect={(key) => select({ key, item: undefined })}
                draggingKey={drag?.kind === 'move' ? drag.key : undefined}
                isDragging={drag !== undefined}
                onDragStart={(key) => setDrag({ kind: 'move', key })}
                onDragEnd={endDrag}
                onDropAt={dropAtPosition}
                onHoverGap={setListGap}
                hoveredGap={listGap}
                carrying={carrying}
                isReadOnly={isReadOnly}
              />
              {selectedBlock && rule ? (
                <Rules aria-labelledby="template-rules">
                  <Typography id="template-rules" variant="sigma" tag="h2" textColor="neutral600">
                    {t('template.edit.rules', { block: nameFor(selectedBlock) })}
                  </Typography>
                  <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                    {t('template.edit.content')}
                    <select
                      value={rule.content}
                      disabled={isReadOnly}
                      onChange={(event) =>
                        state.setRule(selectedBlock.key, {
                          content: event.target.value === 'clear' ? 'clear' : 'sample',
                        })
                      }
                    >
                      <option value="sample">{t('template.save.content.sample')}</option>
                      <option value="clear">{t('template.save.content.clear')}</option>
                    </select>
                  </label>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={rule.fixed}
                      disabled={isReadOnly}
                      onChange={(event) =>
                        state.setRule(selectedBlock.key, { fixed: event.target.checked })
                      }
                    />
                    {t('template.edit.fixed')}
                  </label>
                </Rules>
              ) : null}
            </div>
            <Centre aria-label={t('template.edit.stage')}>
              <Typography variant="pi" textColor="neutral600" tag="p">
                {t('template.edit.noFrame.stage')}
              </Typography>
            </Centre>
            {selectedBlock ? (
              <BlockPanel
                block={selectedBlock}
                name={nameFor(selectedBlock)}
                position={position}
                total={blocks.length}
                fields={fieldsFor(selectedBlock)}
                itemFields={itemFieldsFor(selectedBlock)}
                item={item}
                cost={
                  selectedEntry
                    ? { kb: costKbOf(selectedEntry), isIsland: selectedEntry.cost.island !== null }
                    : undefined
                }
                island={islandOf(selectedEntry)}
                isReadOnly={isReadOnly}
                onSetFields={setValues}
                onSetItem={setItemValues}
                onAddItem={addItem}
                onSelectItem={(next) => setItem(next)}
                onMove={move}
                onDuplicate={copy}
                onRemove={remove}
              />
            ) : (
              <Box
                tag="aside"
                aria-label={t('builder.panel.label')}
                padding={5}
                background="neutral0"
                style={{ flex: '0 1 320px', borderLeft: `1px solid ${colors.neutral150}` }}
              >
                <Typography textColor="neutral600">{t('builder.panel.none')}</Typography>
              </Box>
            )}
          </Columns>
        </Shell>
        {toast ? (
          <Toast key={toast.id} role="status">
            <span>{toast.text}</span>
            {state.canUndo ? (
              <Button type="button" size="S" variant="tertiary" onClick={goBack}>
                {t('builder.toast.undo')}
              </Button>
            ) : null}
          </Toast>
        ) : null}
      </Page.Main>
    </Motion>
  )
}
