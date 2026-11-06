import { Button, Checkbox } from '@strapi/design-system'
import { useFetchClient, useStrapiApp } from '@strapi/strapi/admin'
import { useRef, useState, type ComponentType } from 'react'
import styled, { useTheme } from 'styled-components'

import { useMessages } from '../../messages'
import { filesOf, type MediaField, type MediaFile } from '../../utils/builder/fields'
import { fieldLabel, Input, labelStyle } from './fieldStyle'
import { DownIcon, UpIcon } from './icons'

/** What the Media Library dialog of the Strapi admin takes: it is the dialog the Content Manager opens. */
interface DialogProps {
  allowedTypes?: string[]
  multiple?: boolean
  onClose: () => void
  onSelectAssets: (files: MediaFile[]) => void
}

const Thumb = styled.div`
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 4px;
  overflow: hidden;
  background: ${({ theme }) => theme.colors.neutral150};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: ${({ theme }) => theme.colors.neutral600};
  & > img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`

const Move = styled.button`
  all: unset;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.neutral800};
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

const Add = styled.button`
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

/** The address a stored file is served from: the admin may sit on another origin than the backend. */
export function srcOf(url: string | undefined): string | undefined {
  if (!url || !url.startsWith('/')) return url
  const base = (window as { strapi?: { backendURL?: string } }).strapi?.backendURL ?? ''
  return `${base.replace(/\/$/, '')}${url}`
}

/** A file's size as the Media Library writes it: it stores kilobytes. */
export function sizeOf(kb: number | undefined): string {
  if (kb === undefined) return ''
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} kB`
}

function AltText(props: {
  file: MediaFile
  id: string
  isReadOnly: boolean
  onCommit: (alt: string) => Promise<boolean>
}) {
  const { colors } = useTheme()
  const { t } = useMessages()
  const { file } = props
  const stored = file.alternativeText ?? ''
  const [draft, setDraft] = useState(stored)
  const [isFailed, setIsFailed] = useState(false)
  // The empty string is how a file is marked decorative; `null` is a file nobody described yet.
  // Unticking cannot write `null` (Strapi keeps the old text for it), so it only lets the editor type.
  const [isDecorative, setIsDecorative] = useState(file.alternativeText === '')
  const isMissing = !isDecorative && draft.trim() === ''
  const send = async (alt: string) => setIsFailed(!(await props.onCommit(alt)))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label htmlFor={props.id} style={labelStyle(colors.neutral800)}>
        {t('builder.media.alt')}
        <span aria-hidden="true"> *</span>
      </label>
      <Input
        id={props.id}
        value={isDecorative ? '' : draft}
        disabled={isDecorative || props.isReadOnly}
        required={!isDecorative}
        aria-invalid={isMissing}
        aria-describedby={isMissing ? `${props.id}-error` : undefined}
        placeholder={t('builder.media.altPlaceholder')}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          // An empty line is not written: only the box below marks a file decorative.
          if (draft.trim() === '') setDraft(stored)
          else if (draft !== stored) void send(draft)
        }}
      />
      {isMissing ? (
        <span id={`${props.id}-error`} style={{ fontSize: 12, color: colors.danger700 }}>
          {t('builder.media.altRequired')}
        </span>
      ) : null}
      {isFailed ? (
        <span role="alert" style={{ fontSize: 12, color: colors.danger700 }}>
          {t('builder.media.altFailed')}
        </span>
      ) : null}
      <Checkbox
        checked={isDecorative}
        disabled={props.isReadOnly}
        onCheckedChange={(checked: boolean | 'indeterminate') => {
          if (checked === true) void send('')
          else setIsDecorative(false)
        }}
      >
        {t('builder.media.decorative')}
      </Checkbox>
    </div>
  )
}

/**
 * The media fields of a block or an item (the ContentPanel artboard): each file with its
 * thumbnail, name and size, **Replace** and **Remove**, and for an image its alternative text.
 *
 * @remarks
 * Files are picked in Strapi's own Media Library dialog, the one the Content Manager opens
 * (`components['media-library']`), so folders, files and permissions are the same; the panel never
 * uploads. The alternative text is the file's own `alternativeText`, written to the Media Library
 * with the permission the editor has there; a file marked decorative holds the empty string.
 */
export function MediaInputs(props: {
  fields: MediaField[]
  values: Record<string, unknown>
  idPrefix: string
  isReadOnly: boolean
  missing: string[]
  /** The fields of the block's island alternative: required before the page goes to review. */
  alternative?: readonly string[]
  /** `isStep` is false for a change to a file's alternative text: it is not a step to undo. */
  onChange: (name: string, value: MediaFile | MediaFile[] | null, isStep?: boolean) => void
}) {
  const { colors } = useTheme()
  const { t } = useMessages()
  const { put } = useFetchClient()
  const components = useStrapiApp('MediaInputs', (state) => state.components)
  const Dialog = components['media-library'] as ComponentType<DialogProps> | undefined
  const [open, setOpen] = useState<{ field: MediaField; index: number | undefined }>()
  const latest = useRef(props)
  latest.current = props

  const write = (field: MediaField, files: MediaFile[], isStep = true) =>
    latest.current.onChange(field.name, field.multiple ? files : (files[0] ?? null), isStep)

  const choose = (picked: MediaFile[]) => {
    if (!open) return
    const { field, index } = open
    const files = filesOf(props.values, field.name)
    if (index !== undefined) {
      const [replacement] = picked
      if (replacement)
        write(
          field,
          files.map((file, at) => (at === index ? replacement : file))
        )
    } else {
      const fresh = picked.filter((file) => !files.some(({ id }) => id === file.id))
      write(field, field.multiple ? [...files, ...fresh] : picked.slice(0, 1))
    }
    setOpen(undefined)
  }

  /** Writes the alternative text to the file and to the field; `false` when Strapi refused. */
  const describe = async (field: MediaField, file: MediaFile, alt: string): Promise<boolean> => {
    try {
      await put(`/upload/files/${file.id}`, { fileInfo: { alternativeText: alt } })
    } catch {
      return false
    }
    const files = filesOf(latest.current.values, field.name)
    write(
      field,
      files.map((other) => (other.id === file.id ? { ...other, alternativeText: alt } : other)),
      false
    )
    return true
  }

  return (
    <>
      {props.fields.map((field) => {
        const id = `${props.idPrefix}-${field.name}`
        const files = filesOf(props.values, field.name)
        const isInvalid = props.missing.includes(field.name)
        const isAlternative = props.alternative?.includes(field.name) === true
        return (
          <div
            key={field.name}
            data-testid={isAlternative ? `alternative-${field.name}` : undefined}
            role="group"
            aria-labelledby={`${id}-label`}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <span id={`${id}-label`} style={labelStyle(colors.neutral800)}>
              {fieldLabel(field.name, t)}
              {field.required ? <span aria-hidden="true"> *</span> : null}
            </span>
            {files.map((file, index) => {
              const name = file.name ?? String(file.id)
              const isImage = file.mime?.startsWith('image/') === true
              const thumb = srcOf(file.formats?.thumbnail?.url ?? file.url)
              return (
                <div
                  key={file.id}
                  role="group"
                  aria-label={name}
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <Thumb>
                      {isImage && thumb ? (
                        <img src={thumb} alt="" />
                      ) : (
                        (file.mime ?? '').split('/')[1]
                      )}
                    </Thumb>
                    <div style={{ minWidth: 0, flex: 1, fontSize: 13 }}>
                      <div style={{ overflowWrap: 'anywhere' }}>
                        {name} · {sizeOf(file.size)}
                      </div>
                      {props.isReadOnly ? null : (
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                          <Button
                            type="button"
                            size="S"
                            variant="tertiary"
                            aria-label={t('builder.media.replaceNamed', { name })}
                            onClick={() => setOpen({ field, index })}
                          >
                            {t('builder.media.replace')}
                          </Button>
                          <Button
                            type="button"
                            size="S"
                            variant="danger-light"
                            aria-label={t('builder.media.removeNamed', { name })}
                            onClick={() =>
                              write(
                                field,
                                files.filter((_, at) => at !== index)
                              )
                            }
                          >
                            {t('builder.media.remove')}
                          </Button>
                        </div>
                      )}
                    </div>
                    {field.multiple && !props.isReadOnly ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <Move
                          type="button"
                          aria-label={t('builder.media.upNamed', { name })}
                          disabled={index === 0}
                          onClick={() => write(field, swap(files, index, index - 1))}
                        >
                          <UpIcon />
                        </Move>
                        <Move
                          type="button"
                          aria-label={t('builder.media.downNamed', { name })}
                          disabled={index === files.length - 1}
                          onClick={() => write(field, swap(files, index, index + 1))}
                        >
                          <DownIcon />
                        </Move>
                      </div>
                    ) : null}
                  </div>
                  {isImage ? (
                    <AltText
                      key={`${file.id}-${String(file.alternativeText)}`}
                      file={file}
                      id={`${id}-${file.id}-alt`}
                      isReadOnly={props.isReadOnly}
                      onCommit={(alt) => describe(field, file, alt)}
                    />
                  ) : null}
                </div>
              )
            })}
            {isAlternative ? (
              <span
                style={{ fontSize: 12, color: isInvalid ? colors.danger700 : colors.neutral600 }}
                data-testid={isInvalid ? 'alternative-missing' : undefined}
              >
                {t(
                  isInvalid
                    ? 'builder.island.alternativeRequired'
                    : 'builder.island.alternativeNote'
                )}
              </span>
            ) : isInvalid ? (
              <span style={{ fontSize: 12, color: colors.danger700 }}>
                {t('builder.panel.requiredMedia')}
              </span>
            ) : null}
            {props.isReadOnly || (!field.multiple && files.length > 0) ? null : (
              <Add type="button" onClick={() => setOpen({ field, index: undefined })}>
                {t(field.multiple ? 'builder.media.add' : 'builder.media.choose')}
              </Add>
            )}
          </div>
        )
      })}
      {open && Dialog ? (
        <Dialog
          allowedTypes={open.field.allowedTypes.length > 0 ? open.field.allowedTypes : undefined}
          multiple={open.field.multiple && open.index === undefined}
          onClose={() => setOpen(undefined)}
          onSelectAssets={choose}
        />
      ) : null}
    </>
  )
}

function swap<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  const [moved] = next.splice(from, 1)
  if (moved !== undefined) next.splice(to, 0, moved)
  return next
}
