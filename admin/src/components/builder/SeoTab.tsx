import { Button, Typography } from '@strapi/design-system'
import { useFetchClient, useStrapiApp } from '@strapi/strapi/admin'
import { useEffect, useId, useRef, useState, type ComponentType } from 'react'
import styled, { useTheme } from 'styled-components'

import {
  HERO_COMPONENT,
  HERO_MEDIA_FIELD,
  SEO_LIMITS,
  structuredDataProblem,
  structuredDataType,
} from '../../../../contract/seo'
import type { BuilderDocument } from '../../hooks/useBuilderDocument'
import { useMessages } from '../../messages'
import type { BuilderBlock } from '../../utils/builder/model'
import {
  counterLevel,
  generatedStructuredData,
  robotsOf,
  seoChecks,
  seoDefaults,
  type SeoChange,
  type SeoImage,
} from '../../utils/builder/seo'
import type { MediaFile } from '../../utils/builder/fields'
import { Input } from './fieldStyle'
import { Area, Field, Help, Section } from './SeoFields'
import { SeoPreviews } from './SeoPreviews'
import { srcOf } from './MediaInputs'
import { Check } from './ReviewDialogs'

/** What the Media Library dialog of the Strapi admin takes: the dialog the Content Manager opens. */
interface DialogProps {
  allowedTypes?: string[]
  multiple?: boolean
  onClose: () => void
  onSelectAssets: (files: MediaFile[]) => void
}

/** How long the frontend has to draw the card, in milliseconds. */
const CARD_TIMEOUT_MS = 30_000

const Thumb = styled.div`
  flex: none;
  width: 96px;
  height: 50px;
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

const Code = styled.pre`
  margin: 0;
  padding: 8px 12px;
  max-height: 180px;
  overflow: auto;
  font-size: 12px;
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral100};
`

/** The first image a hero block of the page holds, as the social image it would give by default. */
function heroImageOf(blocks: readonly BuilderBlock[]): SeoImage | null {
  for (const block of blocks) {
    if (block.component !== HERO_COMPONENT) continue
    const file = block.fields[HERO_MEDIA_FIELD] as Record<string, unknown> | null | undefined
    if (file && typeof file.id === 'number' && String(file.mime).startsWith('image/')) {
      return {
        id: file.id,
        name: typeof file.name === 'string' ? file.name : undefined,
        url: typeof file.url === 'string' ? file.url : undefined,
        thumbnail: undefined,
        width: typeof file.width === 'number' ? file.width : null,
        height: typeof file.height === 'number' ? file.height : null,
        alternativeText: null,
      }
    }
  }
  return null
}

interface SeoTabProps {
  document: BuilderDocument
  /** The page's blocks as the builder holds them: the default description is the first paragraph. */
  blocks: BuilderBlock[]
  /** The page's content type and document, for the generated structured data. */
  page: { uid: string; documentId: string }
  /** The host the site's frontend answers on; empty when the preview has none. */
  host: string
  /** The page's `noindex`, as the General tab shows it: the robots line mirrors it. */
  isNoindex: boolean
  isReadOnly: boolean
  /** The frontend's card route for the page (`GET /api/preview/:uid/:documentId/card`); `undefined` while the preview has not loaded. */
  cardUrl: string | undefined
  /** Saves the fields that changed; `true` when the server stored them. */
  onChange: (change: SeoChange) => Promise<boolean>
}

/**
 * The SEO and social tab of the page settings (the Page settings artboard, 5b): the meta title,
 * the meta description and the social image, which start from the page and are edited second, the
 * previews of the page in a search result, a link card and a fediverse post, the advanced fields
 * (canonical URL, robots, keywords, structured data) and the checks the page meets before review.
 *
 * @remarks
 * The counters warn while the editor types and never hold a save: the limits are the checks at
 * send to review (`docs/guide/seo.md`). A field saves when it is left. An empty field shows what the
 * server derives at save (`contract/seo.ts`), and that default is saved when the tab opens, so
 * what the checks list is what the server holds. **Generate from title** asks the frontend's card
 * route with the editor's preview grant, stores the PNG in the Media Library and sets it as the
 * social image; nothing goes to a third party.
 */
export function SeoTab(props: SeoTabProps) {
  const { colors } = useTheme()
  const { t } = useMessages()
  const id = useId()
  const { document: doc } = props
  const stored = doc.seo
  const defaults = seoDefaults(doc.title, doc.siteName, props.blocks)
  const heroImage = heroImageOf(props.blocks)
  const shownTitle = stored.metaTitle || defaults.metaTitle
  const shownDescription = stored.metaDescription || defaults.metaDescription
  const image = stored.image ?? heroImage

  const [title, setTitle] = useState(shownTitle)
  const [description, setDescription] = useState(shownDescription)
  const [canonical, setCanonical] = useState(stored.canonicalURL)
  const [keywords, setKeywords] = useState(stored.keywords)
  const [structured, setStructured] = useState(stored.structuredData)
  const [structuredError, setStructuredError] = useState<string>()
  const [card, setCard] = useState<
    { kind: 'idle' | 'working' } | { kind: 'failed'; detail: string }
  >({
    kind: 'idle',
  })
  const [isImageFailed, setIsImageFailed] = useState(false)
  const [isPicking, setIsPicking] = useState(false)
  const { post } = useFetchClient()
  const postRef = useRef(post)
  postRef.current = post
  const components = useStrapiApp('SeoTab', (state) => state.components)
  const Dialog = components['media-library'] as ComponentType<DialogProps> | undefined
  const latest = useRef(props)
  latest.current = props

  // What the page holds follows a save, or a version taken from another session.
  useEffect(() => setTitle(shownTitle), [shownTitle])
  useEffect(() => setDescription(shownDescription), [shownDescription])
  useEffect(() => setCanonical(stored.canonicalURL), [stored.canonicalURL])
  useEffect(() => setKeywords(stored.keywords), [stored.keywords])
  useEffect(() => setStructured(stored.structuredData), [stored.structuredData])

  // The defaults are saved when the tab opens, so the checks read what the server holds.
  const isSeeded = useRef(false)
  useEffect(() => {
    // Only a draft: a save moves a scheduled page back to draft (the editorial guard), and opening a tab must not.
    if (isSeeded.current || props.isReadOnly) return
    if (doc.editorial !== undefined && doc.editorial.state !== 'draft') return
    isSeeded.current = true
    const change: SeoChange = {}
    if (stored.metaTitle === '' && defaults.metaTitle !== '') change.metaTitle = defaults.metaTitle
    if (stored.metaDescription === '' && defaults.metaDescription !== '') {
      change.metaDescription = defaults.metaDescription
    }
    if (stored.image === null && heroImage) change.metaImage = heroImage.id
    if (Object.keys(change).length > 0) void latest.current.onChange(change)
    // Once, with what the tab opened on.
  }, [])

  const commit = (change: SeoChange) => void props.onChange(change)

  const titleLevel = counterLevel(title.length, 0, SEO_LIMITS.titleMax)
  const descriptionLevel = counterLevel(
    description.length,
    SEO_LIMITS.descriptionMin,
    SEO_LIMITS.descriptionMax
  )
  const counter = (
    length: number,
    level: 'ok' | 'short' | 'over',
    max: number,
    min?: number
  ): string =>
    level === 'over'
      ? t('seo.counter.over', { count: length, max, over: length - max })
      : min === undefined
        ? t('seo.counter', { count: length, max })
        : t('seo.counter.min', { count: length, max, min })
  const counterColor = (level: 'ok' | 'short' | 'over') =>
    level === 'over' ? colors.danger700 : level === 'short' ? colors.warning700 : colors.neutral600

  const checks = seoChecks(doc.title, { metaTitle: title, metaDescription: description }, image)
  const imageUrl = srcOf(image?.thumbnail ?? image?.url)
  const language = doc.locale
  const generated = generatedStructuredData({
    uid: props.page.uid,
    pageType: doc.pageType,
    title: doc.title,
    description,
    image: image?.url
      ? new URL(srcOf(image.url) ?? '', window.location.origin).toString()
      : undefined,
    language,
    url: props.host ? `https://${props.host}/${doc.slug}` : undefined,
  })

  async function generate() {
    if (!props.cardUrl) return
    setCard({ kind: 'working' })
    try {
      const answer = await fetch(props.cardUrl, {
        credentials: 'include',
        signal: AbortSignal.timeout(CARD_TIMEOUT_MS),
      })
      if (!answer.ok) throw new Error(String(answer.status))
      const form = new FormData()
      const name = `card-${doc.slug || 'page'}.png`
      form.append('files', await answer.blob(), name)
      form.append('fileInfo', JSON.stringify({ name, alternativeText: doc.title }))
      const uploaded = await postRef.current<{ id: number }[]>('/upload', form)
      const file = uploaded.data[0]
      if (!file) throw new Error('no file')
      setIsImageFailed(!(await props.onChange({ metaImage: file.id })))
      setCard({ kind: 'idle' })
    } catch (error) {
      setCard({ kind: 'failed', detail: error instanceof Error ? error.message : '' })
    }
  }

  async function saveStructured() {
    const text = structured.trim()
    if (text === stored.structuredData.trim()) return
    const problem = structuredDataProblem(text)
    setStructuredError(problem ?? undefined)
    if (problem) return
    commit({ structuredData: text === '' ? null : JSON.parse(text) })
  }

  const shownImage = (
    <Thumb>
      {imageUrl ? <img src={imageUrl} alt={t('seo.image.alt')} /> : t('seo.preview.noImage')}
    </Thumb>
  )

  return (
    <>
      <Field
        label={t('seo.metaTitle')}
        htmlFor={`${id}-title`}
        counter={counter(title.length, titleLevel, SEO_LIMITS.titleMax)}
        color={counterColor(titleLevel)}
        required
      >
        <Input
          id={`${id}-title`}
          value={title}
          readOnly={props.isReadOnly}
          aria-describedby={`${id}-title-help`}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            if (title !== stored.metaTitle && !props.isReadOnly) commit({ metaTitle: title })
          }}
        />
        <Help id={`${id}-title-help`}>{t('seo.metaTitle.help')}</Help>
      </Field>

      <Field
        label={t('seo.metaDescription')}
        htmlFor={`${id}-description`}
        counter={counter(
          description.length,
          descriptionLevel,
          SEO_LIMITS.descriptionMax,
          SEO_LIMITS.descriptionMin
        )}
        color={counterColor(descriptionLevel)}
        required
      >
        <Area
          id={`${id}-description`}
          rows={3}
          value={description}
          readOnly={props.isReadOnly}
          aria-describedby={`${id}-description-help`}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => {
            if (description !== stored.metaDescription && !props.isReadOnly) {
              commit({ metaDescription: description })
            }
          }}
        />
        <Help id={`${id}-description-help`}>{t('seo.metaDescription.help')}</Help>
      </Field>

      <Section role="group" aria-labelledby={`${id}-image`}>
        <span id={`${id}-image`} style={{ fontSize: 12, fontWeight: 600 }}>
          {t('seo.image')}
          <span aria-hidden="true" style={{ color: colors.danger600 }}>
            {' '}
            *
          </span>
        </span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {shownImage}
          <div style={{ minWidth: 0, flex: 1, fontSize: 13 }}>
            <div data-testid="seo-image-caption" style={{ overflowWrap: 'anywhere' }}>
              {image === null
                ? t('seo.image.none')
                : image.width === null || image.height === null
                  ? t('seo.image.captionUnknown', { name: image.name ?? String(image.id) })
                  : t('seo.image.caption', {
                      name: image.name ?? String(image.id),
                      width: image.width,
                      height: image.height,
                    })}
            </div>
            {props.isReadOnly ? null : (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <Button
                  type="button"
                  size="S"
                  variant="tertiary"
                  onClick={() => setIsPicking(true)}
                >
                  {t(image === null ? 'seo.image.choose' : 'seo.image.chooseAnother')}
                </Button>
                <Button
                  type="button"
                  size="S"
                  variant="tertiary"
                  disabled={card.kind === 'working' || props.cardUrl === undefined}
                  loading={card.kind === 'working'}
                  onClick={() => void generate()}
                >
                  {t(card.kind === 'working' ? 'seo.image.generating' : 'seo.image.generate')}
                </Button>
              </div>
            )}
          </div>
        </div>
        {image &&
        image.width !== null &&
        image.height !== null &&
        (image.width !== SEO_LIMITS.image.width || image.height !== SEO_LIMITS.image.height) ? (
          <Help style={{ color: colors.warning700 }}>{t('seo.image.wrongSize')}</Help>
        ) : null}
        {card.kind === 'failed' ? (
          <span role="alert" style={{ fontSize: 12, color: colors.danger700 }}>
            {t('seo.image.generateFailed', { detail: card.detail })}
          </span>
        ) : null}
        {isImageFailed ? (
          <span role="alert" style={{ fontSize: 12, color: colors.danger700 }}>
            {t('seo.image.saveFailed')}
          </span>
        ) : null}
        <Help>
          {props.cardUrl === undefined
            ? t('seo.image.generateUnavailable')
            : t('seo.image.generateHelp')}
        </Help>
      </Section>
      {isPicking && Dialog ? (
        <Dialog
          allowedTypes={['images']}
          onClose={() => setIsPicking(false)}
          onSelectAssets={(files) => {
            setIsPicking(false)
            const [file] = files
            if (file)
              void props
                .onChange({ metaImage: file.id })
                .then((isSaved) => setIsImageFailed(!isSaved))
          }}
        />
      ) : null}

      <SeoPreviews
        host={props.host}
        slug={doc.slug}
        siteName={doc.siteName ?? ''}
        title={title}
        description={description}
        image={imageUrl}
      />

      <details style={{ borderTop: `1px solid ${colors.neutral150}`, paddingTop: 12 }}>
        <summary style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {t('seo.advanced')}
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
          <Field label={t('seo.canonical')} htmlFor={`${id}-canonical`}>
            <Input
              id={`${id}-canonical`}
              type="url"
              value={canonical}
              readOnly={props.isReadOnly}
              onChange={(event) => setCanonical(event.target.value)}
              onBlur={() => {
                if (canonical !== stored.canonicalURL && !props.isReadOnly)
                  commit({ canonicalURL: canonical })
              }}
            />
            <Help>{t('seo.canonical.help')}</Help>
          </Field>
          <Field label={t('seo.robots')} htmlFor={`${id}-robots`}>
            <Input
              id={`${id}-robots`}
              value={robotsOf(props.isNoindex, stored.metaRobots)}
              readOnly
              aria-describedby={`${id}-robots-help`}
            />
            <Help id={`${id}-robots-help`}>{t('seo.robots.help')}</Help>
          </Field>
          <Field label={t('seo.keywords')} htmlFor={`${id}-keywords`}>
            <Input
              id={`${id}-keywords`}
              value={keywords}
              readOnly={props.isReadOnly}
              onChange={(event) => setKeywords(event.target.value)}
              onBlur={() => {
                if (keywords !== stored.keywords && !props.isReadOnly) commit({ keywords })
              }}
            />
            <Help>{t('seo.keywords.help')}</Help>
          </Field>
          <Section>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{t('seo.structured')}</span>
            <Help>
              {t('seo.structured.generated', {
                type: structuredDataType(props.page.uid, doc.pageType),
              })}
            </Help>
            <Code data-testid="seo-jsonld" tabIndex={0}>
              {structured.trim() === '' ? generated : structured}
            </Code>
            <Field label={t('seo.structured.own')} htmlFor={`${id}-structured`}>
              <Area
                id={`${id}-structured`}
                rows={5}
                spellCheck={false}
                value={structured}
                readOnly={props.isReadOnly}
                aria-invalid={structuredError !== undefined}
                aria-describedby={`${id}-structured-help`}
                onChange={(event) => {
                  setStructured(event.target.value)
                  setStructuredError(undefined)
                }}
                onBlur={() => void saveStructured()}
              />
              <Help id={`${id}-structured-help`}>{t('seo.structured.help')}</Help>
              {structuredError ? (
                <span role="alert" style={{ fontSize: 12, color: colors.danger700 }}>
                  {t('seo.structured.invalid', { detail: structuredError })}
                </span>
              ) : null}
            </Field>
          </Section>
        </div>
      </details>

      <section
        aria-labelledby={`${id}-checks`}
        style={{ padding: 12, borderRadius: 6, background: colors.neutral100 }}
      >
        <Typography id={`${id}-checks`} variant="omega" fontWeight="bold" tag="h3">
          {t('seo.checks')}
        </Typography>
        <ul
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 0,
            margin: '8px 0 0',
          }}
        >
          {checks.problems.length === 0 ? (
            <>
              <Check tone="success">{t('seo.check.limits')}</Check>
              <Check tone="success">{t('seo.check.image')}</Check>
            </>
          ) : (
            checks.problems.map((code) => (
              <Check key={code} tone="warning">
                {t(`seo.problem.${code}`)}
              </Check>
            ))
          )}
          {checks.warnings.map((code) => (
            <Check key={code} tone="warning">
              {t(`seo.warning.${code}`)}
            </Check>
          ))}
        </ul>
      </section>
    </>
  )
}
