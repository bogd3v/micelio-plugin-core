import { Typography } from '@strapi/design-system'
import { useId } from 'react'
import styled, { useTheme } from 'styled-components'

import { hasMessage, useMessages } from '../../messages'
import {
  itemsOf,
  missingRequired,
  type BlockFields,
  type TextField,
} from '../../utils/builder/fields'
import type { BuilderBlock } from '../../utils/builder/model'
import { missingAlternative, weightText, type IslandInfo } from '../../utils/builder/islands'
import { ChevronRightIcon, DownIcon, DuplicateIcon, TrashIcon, UpIcon } from './icons'
import { IslandBadge, alternativeName } from './IslandBadge'

const Aside = styled.aside`
  flex: 0 1 320px;
  min-width: 260px;
  background: ${({ theme }) => theme.colors.neutral0};
  border-left: 1px solid ${({ theme }) => theme.colors.neutral150};
  display: flex;
  flex-direction: column;
`

const Head = styled.div`
  padding: 16px 20px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const Tool = styled.button<{ $isDanger?: boolean }>`
  all: unset;
  box-sizing: border-box;
  flex: none;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  cursor: pointer;
  color: ${({ $isDanger, theme }) => ($isDanger ? theme.colors.danger600 : theme.colors.neutral800)};
  transition: background var(--m-fast) var(--m-ease-out);
  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.neutral100};
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
`

const Body = styled.div`
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const Heading = styled.h3`
  margin: 8px 0 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.neutral600};
`

const Segment = styled.button<{ $isPressed: boolean }>`
  all: unset;
  box-sizing: border-box;
  height: 36px;
  flex: 1;
  min-width: 40px;
  padding: 0 12px;
  text-transform: capitalize;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid
    ${({ $isPressed, theme }) => ($isPressed ? theme.colors.primary600 : theme.colors.neutral200)};
  background: ${({ $isPressed, theme }) => ($isPressed ? theme.colors.primary100 : theme.colors.neutral0)};
  color: ${({ $isPressed, theme }) => ($isPressed ? theme.colors.primary600 : theme.colors.neutral800)};
  font-weight: ${({ $isPressed }) => ($isPressed ? 600 : 400)};
  transition:
    background var(--m-fast) var(--m-ease-out),
    color var(--m-fast) var(--m-ease-out);
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
`

const Input = styled.input`
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
  &[aria-invalid='true'] {
    border-color: ${({ theme }) => theme.colors.danger600};
  }
`

const Textarea = styled.textarea`
  width: 100%;
  min-height: 96px;
  box-sizing: border-box;
  padding: 10px 12px;
  font: inherit;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  resize: vertical;
  &[aria-invalid='true'] {
    border-color: ${({ theme }) => theme.colors.danger600};
  }
`

const ItemRow = styled.button`
  all: unset;
  box-sizing: border-box;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  font-size: 13px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  cursor: pointer;
  &:hover {
    background: ${({ theme }) => theme.colors.neutral100};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
`

const AddItem = styled.button`
  all: unset;
  box-sizing: border-box;
  width: 100%;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed ${({ theme }) => theme.colors.primary600};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral100};
  color: ${({ theme }) => theme.colors.primary600};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
`

const labelStyle = (color: string) => ({ fontSize: 12, fontWeight: 600, color }) as const

/** The label of a field: the plugin's translation for the common names, else the name made readable. */
function fieldLabel(name: string, t: (id: string) => string): string {
  const id = `builder.field.${name}`
  if (hasMessage(id)) return t(id)
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** What the island costs the visitor, and when (the Heavy island artboard): in the design's blue. */
function IslandCost(props: { island: IslandInfo; name: string }) {
  const { colors } = useTheme()
  const { t } = useMessages()
  const { island } = props
  const weight = weightText(island.loadKb)
  return (
    <section
      aria-label={t('builder.island.cost.title')}
      data-testid="island-cost"
      style={{
        padding: 12,
        borderRadius: 4,
        background: colors.secondary100,
        border: `1px solid ${colors.secondary200}`,
        fontSize: 13,
      }}
    >
      <strong style={{ display: 'block', marginBottom: 4 }}>
        {t('builder.island.cost.title')}
      </strong>
      {t(`builder.island.cost.${island.trigger}`, {
        weight: t(`builder.island.${weight.unit}`, { value: weight.value }),
        alternative: alternativeName(t, island.alternative[0]),
      })}
    </section>
  )
}

/**
 * The fields of the island's static alternative that are not text, each with what the block holds:
 * a file is picked in the Content Manager's form, as the rest of the media are. The text ones are
 * in the form above, marked required.
 */
function StaticAlternative(props: {
  island: IslandInfo
  fields: BlockFields
  values: Record<string, unknown>
}) {
  const { colors } = useTheme()
  const { t } = useMessages()
  const files = props.island.alternative.filter(
    (name) => !props.fields.text.some((field) => field.name === name)
  )
  const missing = missingAlternative(props.island, props.values)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {files.map((name) => {
        const file = props.values[name]
        const isSet = !missing.includes(name)
        const label =
          typeof file === 'object' && file !== null && 'name' in file ? String(file.name) : ''
        return (
          <div
            key={name}
            data-testid={`alternative-${name}`}
            style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
          >
            <span style={labelStyle(colors.neutral800)}>
              {fieldLabel(name, t)}
              <span aria-hidden="true"> *</span>
            </span>
            <span style={{ fontSize: 13 }}>
              {isSet ? label || t('builder.island.fileSet') : t('builder.island.fileMissing')}
            </span>
            <span
              style={{ fontSize: 12, color: isSet ? colors.neutral600 : colors.danger700 }}
              data-testid={isSet ? undefined : 'alternative-missing'}
            >
              {t(isSet ? 'builder.island.alternativeNote' : 'builder.island.alternativeRequired')}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * "Run here and fill expected output" (the Heavy islands artboard): the output of the code would
 * become the expected output, which is the static alternative of a runtime island.
 *
 * @remarks
 * Not available yet: the admin has no runtime to run Python, SQL or JavaScript with, and running the
 * editor's code in the page would need a content security policy the admin does not have by default.
 * The button is shown disabled with the reason, so the editor sees where the field comes from.
 */
function RunHere() {
  const { colors } = useTheme()
  const { t } = useMessages()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        disabled
        aria-describedby="run-unavailable"
        style={{
          height: 36,
          padding: '0 12px',
          border: `1px solid ${colors.neutral200}`,
          borderRadius: 4,
          background: colors.neutral100,
          color: colors.neutral600,
          fontSize: 13,
          fontWeight: 600,
          textAlign: 'left',
        }}
      >
        {t('builder.island.run')}
      </button>
      <span id="run-unavailable" style={{ fontSize: 12, color: colors.neutral600 }}>
        {t('builder.island.runUnavailable')}
      </span>
    </div>
  )
}

interface BlockPanelProps {
  block: BuilderBlock
  name: string
  position: number
  total: number
  /** The sorted attributes of the block's component. */
  fields: BlockFields
  /** The fields of the item component, by the field that holds the items. */
  itemFields: Record<string, BlockFields>
  /** The item selected, as the field that holds it and its position, or `undefined` for the block. */
  item: { field: string; index: number } | undefined
  /** What the block adds to the page; `undefined` for a block the site's catalogue no longer lists. */
  cost: { kb: number; isIsland: boolean } | undefined
  /** The island the block renders: its badge, what it costs the visitor and its static alternative. */
  island?: IslandInfo
  isReadOnly: boolean
  onSetFields: (values: Record<string, unknown>) => void
  onSetItem: (field: string, index: number, values: Record<string, unknown>) => void
  onAddItem: (field: string) => void
  onSelectItem: (item: { field: string; index: number } | undefined) => void
  onMove: (step: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
}

function TextInputs(props: {
  fields: TextField[]
  values: Record<string, unknown>
  onChange: (name: string, value: string) => void
  isReadOnly: boolean
  idPrefix: string
  missing: string[]
  /** The fields of the block's island alternative: required before the page goes to review. */
  alternative?: readonly string[]
}) {
  const { colors } = useTheme()
  const { t } = useMessages()
  return (
    <>
      {props.fields.map((field) => {
        const id = `${props.idPrefix}-${field.name}`
        const value =
          typeof props.values[field.name] === 'string' ? (props.values[field.name] as string) : ''
        const isInvalid = props.missing.includes(field.name)
        const isAlternative = props.alternative?.includes(field.name) === true
        const isAlternativeMissing = isAlternative && !isInvalid && value.trim() === ''
        const isRequired = field.required || isAlternative
        const common = {
          id,
          value,
          readOnly: props.isReadOnly,
          required: field.required,
          'aria-invalid': isInvalid,
          'aria-describedby': isInvalid
            ? `${id}-error`
            : isAlternativeMissing
              ? `${id}-alternative`
              : undefined,
          placeholder: isRequired ? undefined : t('builder.panel.optional'),
        }
        return (
          <div key={field.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label htmlFor={id} style={labelStyle(colors.neutral800)}>
              {fieldLabel(field.name, t)}
              {isRequired ? <span aria-hidden="true"> *</span> : null}
            </label>
            {field.multiline ? (
              <Textarea
                {...common}
                onChange={(event) => props.onChange(field.name, event.target.value)}
              />
            ) : (
              <Input
                {...common}
                onChange={(event) => props.onChange(field.name, event.target.value)}
              />
            )}
            {isInvalid ? (
              <span id={`${id}-error`} style={{ fontSize: 12, color: colors.danger700 }}>
                {t('builder.panel.required')}
              </span>
            ) : null}
            {isAlternativeMissing ? (
              <span
                id={`${id}-alternative`}
                data-testid="alternative-missing"
                style={{ fontSize: 12, color: colors.danger700 }}
              >
                {t('builder.island.alternativeRequired')}
              </span>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

/**
 * The panel of the selected block (the Builder artboard): its presentation options from the
 * vocabulary, its text fields, its items one level down, and what it adds to the page.
 *
 * @remarks
 * It edits what the host's component stores and nothing it cannot show as text or as a choice:
 * media and relations stay in the Content Manager's form. A required field that is empty is
 * marked, and the save still goes through (a draft may be incomplete; review and publish check).
 */
export function BlockPanel(props: BlockPanelProps) {
  const { colors } = useTheme()
  const { t } = useMessages()
  const id = useId()
  const { block, fields, item } = props
  const itemList = item ? itemsOf(block.fields, item.field) : []
  const current = item ? itemList[item.index] : undefined
  const currentFields = item ? props.itemFields[item.field] : undefined
  const missing = missingRequired(
    item && currentFields ? currentFields : fields,
    current ?? block.fields
  )
  return (
    <Aside
      aria-label={t('builder.panel.label')}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && item) {
          event.stopPropagation()
          props.onSelectItem(undefined)
        }
      }}
    >
      <Head>
        <div style={{ minWidth: 0 }}>
          <Typography variant="delta" tag="h2" fontWeight="bold">
            {props.name}
          </Typography>
          <div style={{ fontSize: 11, color: colors.neutral600 }}>
            <code>{block.component}</code> ·{' '}
            {t('builder.panel.position', { position: props.position + 1, total: props.total })}
          </div>
          {props.island ? (
            <div style={{ marginTop: 6 }}>
              <IslandBadge island={props.island} variant="chip" />
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <Tool
            type="button"
            aria-label={t('builder.panel.up')}
            aria-keyshortcuts="Alt+ArrowUp"
            disabled={props.isReadOnly || props.position === 0}
            onClick={() => props.onMove(-1)}
          >
            <UpIcon />
          </Tool>
          <Tool
            type="button"
            aria-label={t('builder.panel.down')}
            aria-keyshortcuts="Alt+ArrowDown"
            disabled={props.isReadOnly || props.position === props.total - 1}
            onClick={() => props.onMove(1)}
          >
            <DownIcon />
          </Tool>
          <Tool
            type="button"
            aria-label={t('builder.panel.duplicate')}
            // A copy of a block the site no longer lists would be refused as an addition.
            disabled={props.isReadOnly || props.cost === undefined}
            onClick={props.onDuplicate}
          >
            <DuplicateIcon />
          </Tool>
          <Tool
            type="button"
            $isDanger
            aria-label={t('builder.panel.remove')}
            disabled={props.isReadOnly}
            onClick={props.onRemove}
          >
            <TrashIcon />
          </Tool>
        </div>
      </Head>
      <Body>
        {item ? (
          <nav aria-label={t('builder.panel.breadcrumb')} style={{ fontSize: 13 }}>
            <button
              type="button"
              onClick={() => props.onSelectItem(undefined)}
              style={{
                all: 'unset',
                cursor: 'pointer',
                color: colors.primary600,
                textDecoration: 'underline',
              }}
            >
              {props.name}
            </button>{' '}
            › <span aria-current="page">{t('builder.panel.item', { number: item.index + 1 })}</span>
            <div style={{ fontSize: 11, color: colors.neutral600 }}>
              <code>{fields.items.find(({ name }) => name === item.field)?.component}</code> ·{' '}
              {t('builder.panel.escUp')}
            </div>
          </nav>
        ) : null}
        {item && currentFields ? (
          <TextInputs
            fields={currentFields.text}
            values={current ?? {}}
            idPrefix={`${id}-item`}
            isReadOnly={props.isReadOnly}
            missing={missing}
            onChange={(name, value) => props.onSetItem(item.field, item.index, { [name]: value })}
          />
        ) : (
          <>
            {props.island ? <IslandCost island={props.island} name={props.name} /> : null}
            {fields.options.length > 0 ? (
              <>
                <Heading>{t('builder.panel.presentation')}</Heading>
                {fields.options.map((option) => (
                  <div
                    key={option.name}
                    role="group"
                    aria-labelledby={`${id}-${option.name}`}
                    style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                  >
                    <span id={`${id}-${option.name}`} style={labelStyle(colors.neutral800)}>
                      {fieldLabel(option.name, t)}
                    </span>
                    <div style={{ display: 'flex' }}>
                      {option.values.map((value) => (
                        <Segment
                          key={value}
                          type="button"
                          $isPressed={block.fields[option.name] === value}
                          aria-pressed={block.fields[option.name] === value}
                          disabled={props.isReadOnly}
                          onClick={() => props.onSetFields({ [option.name]: value })}
                        >
                          {value}
                        </Segment>
                      ))}
                    </div>
                  </div>
                ))}
                <Typography variant="pi" textColor="neutral600" tag="p">
                  {t('builder.panel.optionsNote')}
                </Typography>
              </>
            ) : null}
            {fields.text.length > 0 || fields.items.length > 0 ? (
              <Heading>{t('builder.panel.content')}</Heading>
            ) : null}
            {props.island ? (
              <StaticAlternative island={props.island} fields={fields} values={block.fields} />
            ) : null}
            <TextInputs
              fields={fields.text}
              values={block.fields}
              idPrefix={`${id}-field`}
              isReadOnly={props.isReadOnly}
              missing={missing}
              alternative={props.island?.alternative}
              onChange={(name, value) => props.onSetFields({ [name]: value })}
            />
            {props.island?.kind === 'runtime' ? <RunHere /> : null}
            {fields.items.map((group) => {
              const list = itemsOf(block.fields, group.name)
              return (
                <div key={group.name} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={labelStyle(colors.neutral800)}>
                    {fieldLabel(group.name, t)} ({list.length})
                    {group.required ? <span aria-hidden="true"> *</span> : null}
                  </span>
                  {missing.includes(group.name) ? (
                    <span style={{ fontSize: 12, color: colors.danger700 }}>
                      {t('builder.panel.required')}
                    </span>
                  ) : null}
                  {list.map((_, index) => (
                    <ItemRow
                      key={index}
                      type="button"
                      onClick={() => props.onSelectItem({ field: group.name, index })}
                    >
                      <span>{t('builder.panel.item', { number: index + 1 })}</span>
                      <ChevronRightIcon />
                    </ItemRow>
                  ))}
                  {props.isReadOnly ? null : (
                    <AddItem type="button" onClick={() => props.onAddItem(group.name)}>
                      {t('builder.panel.addItem')}
                    </AddItem>
                  )}
                </div>
              )
            })}
          </>
        )}
        <Heading style={{ borderTop: `1px solid ${colors.neutral150}`, paddingTop: 12 }}>
          {t('builder.panel.thisBlock')}
        </Heading>
        {props.cost ? (
          <dl
            style={{
              margin: 0,
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '4px 12px',
              fontSize: 13,
            }}
          >
            <dt style={{ color: colors.neutral600 }}>{t('builder.panel.cost')}</dt>
            <dd style={{ margin: 0 }}>
              {t(props.cost.isIsland ? 'builder.panel.costIsland' : 'builder.panel.costStatic', {
                kb: props.cost.kb,
              })}
            </dd>
          </dl>
        ) : (
          <Typography variant="pi" textColor="neutral600" tag="p">
            {t('builder.panel.unlisted')}
          </Typography>
        )}
      </Body>
    </Aside>
  )
}
