import { Box, Button, Typography } from '@strapi/design-system'
import { Page, useAuth } from '@strapi/strapi/admin'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from 'styled-components'
import { useParams, useSearchParams } from 'react-router-dom'

import { BlockList } from '../components/builder/BlockList'
import { BlockPanel } from '../components/builder/BlockPanel'
import { BuilderHeader } from '../components/builder/BuilderHeader'
import { Centre, Columns, Shell, StageBox, Toast } from '../components/builder/layout'
import { Motion } from '../components/builder/Motion'
import { PageSettingsDrawer } from '../components/builder/PageSettingsDrawer'
import { Overlay, type Pointed, type RenderedBlock } from '../components/builder/Overlay'
import { Palette } from '../components/builder/Palette'
import { Notice } from '../components/Notice'
import { PreviewFrame, type FrameState, type PreviewFrameHandle } from '../components/PreviewFrame'
import { useBudget } from '../hooks/useBudget'
import { useBlockLookup } from '../hooks/useBlockLookup'
import { useBuilderCatalogue, type BuilderCatalogue } from '../hooks/useBuilderCatalogue'
import { useBuilderDocument } from '../hooks/useBuilderDocument'
import { RECENT_KEY, useBuilderEdits } from '../hooks/useBuilderEdits'
import { useRefusalNotice } from '../hooks/useRefusalNotice'
import { useBuilderFrame } from '../hooks/useBuilderFrame'
import { usePageSettings } from '../hooks/usePageSettings'
import { usePreviewSource } from '../hooks/usePreviewSource'
import { useMessages } from '../messages'
import { PREVIEW_PERMISSION } from '../permissions'
import { isIncomplete } from '../utils/builder/fields'
import { withoutHiddenOptions, type BuilderBlock } from '../utils/builder/model'
import { refusedBlockOf } from '../utils/builder/refusal'
import {
  costKbOf,
  groupRows,
  matches,
  nameOf,
  stateOf,
  type PaletteRow,
} from '../utils/builder/palette'
import { weightRoute } from '../utils/costMeter'
import { DEVICES, type DeviceId, type PreviewMode } from '../utils/previewPane'
import { useIntl } from 'react-intl'

const NO_FRAME: FrameState = {
  protocol: 'waiting',
  versions: [],
  version: undefined,
  isBusy: false,
  isSilent: false,
}

/** The builder (issue #49): compose a page from the palette while the frontend renders it. */
export default function BuilderPage() {
  return (
    <Page.Protect permissions={[PREVIEW_PERMISSION]}>
      <Builder />
    </Page.Protect>
  )
}

function readRecent(): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []
  } catch {
    // Storage that is blocked or holds something else: the palette starts without recent blocks.
    return []
  }
}

function Builder() {
  const { colors } = useTheme()
  const { t } = useMessages()
  const { locale: language } = useIntl()
  const { uid = '', documentId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const locale = searchParams.get('locale')
  const permissions = useAuth('BuilderPage', (state) => state.permissions)
  const canEdit = permissions.some(
    ({ action, subject }) => action === 'plugin::content-manager.explorer.update' && subject === uid
  )
  const [catalogue, setCatalogue] = useState<BuilderCatalogue>()
  const { byComponent, entryOf, fieldsFor, itemFieldsFor } = useBlockLookup(catalogue)
  const state = useBuilderDocument(
    uid,
    documentId,
    locale,
    (block) => withoutHiddenOptions(block, catalogue?.entries),
    (block) => isIncomplete(fieldsFor(block), itemFieldsFor(block), block.fields),
    catalogue?.schemas
  )
  const { blocks } = state
  const doc = state.resource.kind === 'ready' ? state.resource.document : undefined
  const catalogueResource = useBuilderCatalogue(uid, doc?.site)
  useEffect(() => {
    setCatalogue(catalogueResource.kind === 'ready' ? catalogueResource.catalogue : undefined)
  }, [catalogueResource])

  const [device, setDevice] = useState<DeviceId>('desktop')
  const [mode, setMode] = useState<PreviewMode>('live')
  const [frameState, setFrameState] = useState<FrameState>(NO_FRAME)
  const [isBlocked, setIsBlocked] = useState(false)
  const [search, setSearch] = useState('')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>(readRecent)
  const [now, setNow] = useState(Date.now())
  const frame = useRef<PreviewFrameHandle>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const entryPath = `/content-manager/collection-types/${uid}/${documentId}${
    doc?.locale ? `?plugins[i18n][locale]=${doc.locale}` : ''
  }`

  const { source, reload } = usePreviewSource(
    doc ? { uid, documentId, locale: doc.locale } : undefined,
    mode
  )
  const origin = source.kind === 'ready' ? source.origin : undefined
  useEffect(() => setIsBlocked(false), [origin])
  const weightUrl =
    source.kind === 'ready' && frameState.protocol === 'ok'
      ? weightRoute(source.src, uid, documentId, doc ? doc.locale : locale)
      : undefined
  const { resource: budget } = useBudget(
    uid,
    documentId,
    doc ? doc.locale : locale,
    state.version,
    weightUrl
  )
  const pageSettings = usePageSettings({
    isOpen: isSettingsOpen,
    uid,
    documentId,
    locale: doc ? doc.locale : locale,
    site: doc?.site,
    version: state.version,
  })
  const canOpenSettings = doc?.hasPageSettings === true
  // ⌘, (Ctrl+, elsewhere) opens the page settings, from anywhere on the page.
  useEffect(() => {
    if (!canOpenSettings) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.code === 'Comma' && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault()
        setIsSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canOpenSettings])
  const leftKb =
    budget.kind === 'ready' ? budget.measurement.budgetKb - budget.measurement.blocksKb : undefined

  const nameFor = (block: BuilderBlock): string => {
    const entry = entryOf(block)
    return entry ? nameOf(entry, language) : block.component
  }
  const pageType = doc?.pageType ?? 'standard'

  // Palette: the blocks the site offers that this page type's zone accepts.
  const rows = useMemo<PaletteRow[]>(
    () =>
      (catalogue?.entries ?? [])
        .filter((entry) => catalogue?.zoneComponents.includes(entry.component))
        .map((entry) => ({
          entry,
          name: nameOf(entry, language),
          costKb: costKbOf(entry),
          isIsland: entry.cost.island !== null,
          state: stateOf(entry, pageType, leftKb),
        })),
    [catalogue, language, pageType, leftKb]
  )
  const groups = groupRows(rows, search, recent)
  const matched = rows.filter((row) => matches(row, search)).length

  // The blocks the frame renders, by position, as of the version it shows.
  const { selection, select, report, hovered, addressOf, renderedAt, onFrameMessage } =
    useBuilderFrame({
      state,
      catalogue,
      byComponent,
      fieldsFor,
      frame,
      frameState,
      reload,
    })
  const selectedKey = selection?.key
  const rendered: RenderedBlock[] = renderedAt(report?.version ?? frameState.version ?? '').flatMap(
    (shown, index) => {
      const block = blocks.find(({ key }) => key === shown.key)
      if (!block) return [{ index, name: shown.component }]
      const isMissing = isIncomplete(fieldsFor(block), itemFieldsFor(block), block.fields)
      return [
        {
          index,
          name: nameFor(block),
          problem: isMissing ? t('builder.overlay.needsContent') : undefined,
        },
      ]
    }
  )

  useRefusalNotice(state)
  const refusedBlock = refusedBlockOf(blocks, state.refusal?.block, entryOf)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [])

  const selectedBlock = blocks.find((block) => block.key === selectedKey)
  const isReadOnly = !canEdit
  const edits = useBuilderEdits({
    state,
    catalogue,
    language,
    selection,
    select,
    selectedBlock,
    isReadOnly,
    fieldsFor,
    addressOf,
    renderedAt,
    reportVersion: report?.version,
    frameVersion: frameState.version,
    frame,
    recent,
    setRecent,
  })
  const {
    drag,
    setDrag,
    target,
    listGap,
    setListGap,
    toast,
    insertEntry,
    afterSelection,
    positionOfGap,
    dropAtPosition,
    endDrag,
    onTarget,
    move,
    copy,
    remove,
    setValues,
    setItem,
    addItem,
    goBack,
  } = edits

  if (state.resource.kind === 'error') {
    return (
      <Page.Main>
        <Page.Title>{t('builder.title')}</Page.Title>
        <Box padding={6}>
          <Typography role="alert">
            {t(state.resource.status === 404 ? 'preview.error.missing' : 'preview.error.entry')}
          </Typography>
        </Box>
      </Page.Main>
    )
  }
  if (doc && !doc.site) {
    return (
      <Page.Main>
        <Page.Title>{t('builder.title')}</Page.Title>
        <Box padding={6}>
          <Typography role="alert">{t('builder.error.site')}</Typography>
        </Box>
      </Page.Main>
    )
  }
  if (catalogueResource.kind === 'error') {
    return (
      <Page.Main>
        <Page.Title>{t('builder.title')}</Page.Title>
        <Box padding={6}>
          <Typography role="alert">{t(`builder.error.${catalogueResource.reason}`)}</Typography>
        </Box>
      </Page.Main>
    )
  }

  const width = DEVICES.find((item) => item.id === device)?.width ?? 1280
  const title = doc?.title ?? t('builder.title')
  const savedAgo = state.savedAt
    ? t('builder.save.ago', { seconds: Math.max(0, Math.round((now - state.savedAt) / 1000)) })
    : undefined
  const selectedIndex = selectedKey
    ? renderedAt(report?.version ?? frameState.version ?? '').findIndex(
        (block) => block.key === selectedKey
      )
    : -1
  const pointedSelected: Pointed | undefined =
    selection && selectedIndex >= 0
      ? { index: selectedIndex, item: selection.item?.index ?? null }
      : undefined
  const selectedEntry = selectedBlock ? entryOf(selectedBlock) : undefined
  const position = selectedBlock ? blocks.indexOf(selectedBlock) : -1
  const isSilent = frameState.isSilent && !isBlocked && source.kind === 'ready'

  return (
    <Motion>
      <Page.Main>
        <Page.Title>{t('builder.page', { title })}</Page.Title>
        <Shell>
          <BuilderHeader
            title={title}
            document={doc}
            kind={uid.split('.').pop() ?? uid}
            entryPath={entryPath}
            status={state.status}
            isDirty={state.isDirty}
            savedAgo={savedAgo}
            device={device}
            onDevice={setDevice}
            mode={mode}
            onMode={setMode}
            budget={budget}
            onSave={state.saveNow}
            isReadOnly={isReadOnly}
            onOpenSettings={canOpenSettings ? () => setIsSettingsOpen(true) : undefined}
            isSettingsOpen={isSettingsOpen}
          />
          {state.status === 'conflict' ? (
            <Notice
              role="alert"
              title={t('builder.conflict.title')}
              text={t('builder.conflict.body')}
            >
              <Button type="button" variant="secondary" onClick={state.loadTheirs}>
                {t('builder.conflict.theirs')}
              </Button>{' '}
              {state.isDirty ? (
                <Button type="button" variant="tertiary" onClick={state.keepMine}>
                  {t('builder.conflict.mine')}
                </Button>
              ) : null}
            </Notice>
          ) : null}
          {state.status === 'failed' && state.refusal ? (
            <Notice
              role="alert"
              title={t('builder.refusal.title')}
              text={state.refusal.detail || t('builder.refusal.failed')}
            >
              {refusedBlock ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => select({ key: refusedBlock.key, item: undefined })}
                >
                  {t('builder.refusal.link')}
                </Button>
              ) : null}
            </Notice>
          ) : null}
          {isReadOnly ? <Notice role="status" text={t('builder.readOnly')} /> : null}
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
                leftKb={leftKb}
                search={search}
                onSearch={setSearch}
                total={rows.length}
                matched={matched}
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
                  hasProblem: isIncomplete(fieldsFor(block), itemFieldsFor(block), block.fields),
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
                isReadOnly={isReadOnly}
              />
            </div>
            <Centre aria-label={t('preview.pane')}>
              <Typography variant="pi" textColor="neutral600" tag="p">
                {t('builder.live', { host: origin ? new URL(origin).host : '' })}
              </Typography>
              {source.kind === 'error' ? (
                <Notice role="alert" text={t(`preview.error.${source.reason}`)} />
              ) : null}
              {isBlocked ? (
                <Notice
                  role="alert"
                  title={t('preview.blocked.title')}
                  text={t('preview.blocked.body', { origin: origin ?? '' })}
                />
              ) : null}
              {frameState.protocol === 'upgrade' ? (
                <Notice
                  role="status"
                  title={t('preview.upgrade.title')}
                  text={t('preview.upgrade.body', { versions: frameState.versions.join(', ') })}
                />
              ) : null}
              {isSilent ? (
                <Notice
                  role="status"
                  title={t('preview.silent.title')}
                  text={t('preview.silent.body')}
                />
              ) : null}
              <StageBox>
                {isBlocked || source.kind === 'error' ? null : (
                  <PreviewFrame
                    ref={frame}
                    src={source.kind === 'ready' ? source.src : undefined}
                    origin={origin}
                    documentId={documentId}
                    locale={doc?.locale ?? null}
                    title={t('preview.frame.title', { title })}
                    width={width}
                    onChange={setFrameState}
                    onBlocked={() => setIsBlocked(true)}
                    isCovered={isSilent}
                    onMessage={onFrameMessage}
                  >
                    <Overlay
                      report={report}
                      rendered={rendered}
                      selected={pointedSelected}
                      hovered={hovered}
                      isDragging={drag !== undefined}
                      target={target}
                      onTarget={onTarget}
                      onDrop={(gap) => dropAtPosition(positionOfGap(gap))}
                      onMove={move}
                      onDuplicate={copy}
                      canDuplicate={selectedEntry !== undefined}
                      onAddAtEnd={() => {
                        select(undefined)
                        searchInput.current?.focus()
                      }}
                      isReadOnly={isReadOnly}
                    />
                  </PreviewFrame>
                )}
              </StageBox>
            </Centre>
            {selectedBlock ? (
              <BlockPanel
                block={selectedBlock}
                name={nameFor(selectedBlock)}
                position={position}
                total={blocks.length}
                fields={fieldsFor(selectedBlock)}
                itemFields={itemFieldsFor(selectedBlock)}
                item={selection?.item}
                cost={
                  selectedEntry
                    ? { kb: costKbOf(selectedEntry), isIsland: selectedEntry.cost.island !== null }
                    : undefined
                }
                isReadOnly={isReadOnly}
                onSetFields={setValues}
                onSetItem={setItem}
                onAddItem={addItem}
                onSelectItem={(item) => select({ key: selectedBlock.key, item })}
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
        {isSettingsOpen && doc ? (
          <PageSettingsDrawer
            document={doc}
            host={origin ? new URL(origin).host : ''}
            data={pageSettings}
            isReadOnly={isReadOnly}
            onSave={state.saveSettings}
            onClose={() => setIsSettingsOpen(false)}
          />
        ) : null}
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
