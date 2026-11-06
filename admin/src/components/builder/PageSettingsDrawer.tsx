import { Button, Checkbox, Typography } from '@strapi/design-system'
import { useEffect, useId, useRef, useState } from 'react'
import styled, { useTheme } from 'styled-components'

import type { BuilderDocument } from '../../hooks/useBuilderDocument'
import type { PageSettingsData } from '../../hooks/usePageSettings'
import { useMessages } from '../../messages'
import {
  isSlugValid,
  offeredPageTypes,
  pageTypeName,
  type PageSettingsValues,
  type Visibility,
} from '../../utils/builder/pageSettings'
import type { SaveRefusal } from '../../utils/builder/refusal'
import { Segment, Tool } from './controls'
import { Input } from './fieldStyle'
import { CloseIcon } from './icons'

const Panel = styled.aside`
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  width: min(400px, 100vw);
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.neutral0};
  border-left: 1px solid ${({ theme }) => theme.colors.neutral150};
  box-shadow: ${({ theme }) => theme.shadows.tableShadow};
  transition:
    transform var(--m-base) var(--m-ease-out),
    opacity var(--m-base) var(--m-ease-out);
  @starting-style {
    transform: translateX(var(--m-offset));
    opacity: 0;
  }
`

const Head = styled.header`
  padding: 20px 20px 16px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`

const Tabs = styled.div`
  display: flex;
  gap: 4px;
  padding: 0 20px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
`

const Tab = styled.button`
  all: unset;
  box-sizing: border-box;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: default;
  color: ${({ theme }) => theme.colors.primary600};
  border-bottom: 2px solid ${({ theme }) => theme.colors.primary600};
  margin-bottom: -1px;
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: -2px;
  }
`

const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
`

const Foot = styled.footer`
  padding: 14px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
`

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const Pair = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
`

const Prefix = styled.span`
  flex: none;
  display: inline-flex;
  align-items: center;
  max-width: 55%;
  padding: 0 10px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.neutral600};
  background: ${({ theme }) => theme.colors.neutral100};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-right: 0;
  border-radius: 4px 0 0 4px;
`

const SlugInput = styled(Input)`
  border-radius: 0 4px 4px 0;
`

const Row = styled.li`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
`

interface PageSettingsDrawerProps {
  /** The page as the builder holds it. */
  document: BuilderDocument
  /** The host the site's frontend answers on, shown before the slug; empty when the preview has none. */
  host: string
  data: PageSettingsData
  isReadOnly: boolean
  onSave: (values: Partial<PageSettingsValues>) => Promise<SaveRefusal | undefined>
  /** Opens the Save as template dialog; absent for a role that may not manage templates. */
  onSaveAsTemplate?: () => void
  /** The page has changes the CMS does not hold yet, which a template would miss. */
  isDirty?: boolean
  onClose: () => void
}

type Outcome = { kind: 'idle' | 'saving' | 'saved' } | { kind: 'failed'; detail: string }

/**
 * The Page settings drawer, General tab (the Page settings artboard): site and language of the
 * page, its slug, its page type, where it shows up, and the redirects that lead to it.
 *
 * @remarks
 * It opens over the builder and leaves the preview in view; Esc and the close button shut it and
 * focus goes back to where it came from. Each choice is saved at once, with the draft's version
 * (`useBuilderDocument().saveSettings`); the slug is saved when its field is left. The other tabs
 * of the artboard (SEO and social, Template) belong to other issues and are not drawn. **Save as
 * template…** opens the dialog of that name (`SaveTemplateDialog`) for a role that may manage templates.
 */
export function PageSettingsDrawer(props: PageSettingsDrawerProps) {
  const { colors } = useTheme()
  const { t } = useMessages()
  const id = useId()
  const { document: doc, data } = props
  const [slug, setSlug] = useState(doc.slug)
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' })
  const [removal, setRemoval] = useState<'failed' | undefined>()
  const slugInput = useRef<HTMLInputElement>(null)
  const pageType = doc.pageType ?? 'standard'
  const types = offeredPageTypes(data.pageTypes, pageType)
  const budgetKb = types.find((type) => type.id === pageType)?.budgetKb
  const isSlugBad = slug !== '' && !isSlugValid(slug)

  // The slug the page holds follows a save or a version taken from another session.
  useEffect(() => setSlug(doc.slug), [doc.slug])

  // Focus goes in on open and back to the control that opened it on close.
  useEffect(() => {
    const opener = window.document.activeElement as HTMLElement | null
    slugInput.current?.focus()
    return () => opener?.focus()
  }, [])

  // What the boxes show and what the next save sends: the editor's last choice, which is ahead of
  // the page's `doc.visibility` while saves are in flight.
  const [visibility, setVisibilityState] = useState(doc.visibility)
  const visibilityRef = useRef(doc.visibility)
  const docRef = useRef(doc)
  docRef.current = doc
  // The saves of the drawer wait in a line, so they reach the CMS in the order they were made.
  const lineRef = useRef<Promise<unknown>>(Promise.resolve())
  const pendingRef = useRef(0)
  const onSaveRef = useRef(props.onSave)
  onSaveRef.current = props.onSave

  const showVisibility = (next: Visibility) => {
    visibilityRef.current = next
    setVisibilityState(next)
  }

  // A version taken from another session, or a save that finished with none in flight, is the truth.
  useEffect(() => {
    if (pendingRef.current === 0) showVisibility(doc.visibility)
  }, [doc.visibility])

  function commit(values: Partial<PageSettingsValues>): Promise<void> {
    pendingRef.current += 1
    setOutcome({ kind: 'saving' })
    const turn = lineRef.current.then(() => onSaveRef.current(values))
    lineRef.current = turn.catch(() => undefined)
    return turn.then((refused) => {
      pendingRef.current -= 1
      // One status for the line: it says Saved only when the last save is stored.
      if (pendingRef.current > 0) return
      setOutcome(refused ? { kind: 'failed', detail: refused.detail } : { kind: 'saved' })
      // The boxes go back to what the CMS holds: a refused choice does not stay ticked.
      if (refused) showVisibility(docRef.current.visibility)
    })
  }

  const saveSlug = () => {
    if (slug === doc.slug || slug === '' || isSlugBad || props.isReadOnly) return
    void commit({ slug })
  }
  const setVisibility = (key: keyof Visibility, value: boolean) => {
    // Over the last choice, not over the page's copy, which a save in flight has not reached.
    const next = { ...visibilityRef.current, [key]: value }
    showVisibility(next)
    void commit({ visibility: next })
  }

  const live = data.publishedSlug
  const slugHelp = !live
    ? t('builder.settings.slug.neverPublished')
    : live === doc.slug
      ? t('builder.settings.slug.live', { path: `/${live}` })
      : t('builder.settings.slug.renamed', { path: `/${live}` })
  const status =
    outcome.kind === 'saving'
      ? t('builder.settings.saving')
      : outcome.kind === 'saved'
        ? t('builder.settings.saved')
        : outcome.kind === 'failed'
          ? t('builder.settings.failed', { detail: outcome.detail })
          : ''

  return (
    <Panel
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          props.onClose()
        }
      }}
    >
      <Head>
        <div style={{ minWidth: 0 }}>
          <Typography id={`${id}-title`} variant="beta" tag="h2" fontWeight="bold">
            {t('builder.settings.title')}
          </Typography>
          <Typography variant="pi" textColor="neutral600" tag="p">
            {doc.title}
          </Typography>
        </div>
        <Tool type="button" aria-label={t('builder.settings.close')} onClick={props.onClose}>
          <CloseIcon />
        </Tool>
      </Head>
      <Tabs role="tablist" aria-label={t('builder.settings.tabs')}>
        <Tab
          type="button"
          role="tab"
          aria-selected="true"
          id={`${id}-tab`}
          aria-controls={`${id}-panel`}
        >
          {t('builder.settings.tab.general')}
        </Tab>
      </Tabs>
      <Body role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab`}>
        <Pair>
          <Field>
            <label htmlFor={`${id}-site`} style={{ fontSize: 12, fontWeight: 600 }}>
              {t('builder.settings.site')}
            </label>
            <Input id={`${id}-site`} value={doc.site ?? ''} readOnly />
          </Field>
          <Field>
            <label htmlFor={`${id}-locale`} style={{ fontSize: 12, fontWeight: 600 }}>
              {t('builder.settings.locale')}
            </label>
            <Input id={`${id}-locale`} value={doc.locale ?? ''} readOnly />
          </Field>
        </Pair>

        <Field>
          <label htmlFor={`${id}-slug`} style={{ fontSize: 12, fontWeight: 600 }}>
            {t('builder.settings.slug')}
            <span aria-hidden="true" style={{ color: colors.danger600 }}>
              {' '}
              *
            </span>
          </label>
          <div style={{ display: 'flex' }}>
            {props.host ? <Prefix>{props.host}/</Prefix> : null}
            <SlugInput
              id={`${id}-slug`}
              ref={slugInput}
              value={slug}
              readOnly={props.isReadOnly}
              required
              aria-invalid={isSlugBad || slug === ''}
              aria-describedby={`${id}-slug-help`}
              onChange={(event) => setSlug(event.target.value)}
              onBlur={saveSlug}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveSlug()
              }}
            />
          </div>
          <span id={`${id}-slug-help`} style={{ fontSize: 12, color: colors.neutral600 }}>
            {isSlugBad ? t('builder.settings.slug.invalid') : slugHelp}
          </span>
        </Field>

        <Field role="group" aria-labelledby={`${id}-type`}>
          <span id={`${id}-type`} style={{ fontSize: 12, fontWeight: 600 }}>
            {t('builder.settings.pageType')}
          </span>
          <div style={{ display: 'flex' }}>
            {types.map((type) => (
              <Segment
                key={type.id}
                type="button"
                $isPressed={type.id === pageType}
                aria-pressed={type.id === pageType}
                disabled={props.isReadOnly}
                style={{ textTransform: 'none' }}
                onClick={() => {
                  if (type.id !== pageType) void commit({ pageType: type.id })
                }}
              >
                {pageTypeName(type.id)}
              </Segment>
            ))}
          </div>
          <span style={{ fontSize: 12, color: colors.neutral600 }}>
            {t('builder.settings.pageType.help', {
              type: pageTypeName(pageType),
              kb: budgetKb ?? '—',
            })}
          </span>
        </Field>

        <Field role="group" aria-labelledby={`${id}-visibility`}>
          <span id={`${id}-visibility`} style={{ fontSize: 12, fontWeight: 600 }}>
            {t('builder.settings.visibility')}
          </span>
          <Checkbox
            checked={visibility.inMenu}
            disabled={props.isReadOnly}
            onCheckedChange={(value: boolean | 'indeterminate') =>
              setVisibility('inMenu', value === true)
            }
          >
            {t('builder.settings.visibility.inMenu')}
          </Checkbox>
          <Checkbox
            checked={visibility.inSitemap}
            disabled={props.isReadOnly}
            onCheckedChange={(value: boolean | 'indeterminate') =>
              setVisibility('inSitemap', value === true)
            }
          >
            {t('builder.settings.visibility.inSitemap')}
          </Checkbox>
          <Checkbox
            checked={visibility.noindex}
            disabled={props.isReadOnly}
            onCheckedChange={(value: boolean | 'indeterminate') =>
              setVisibility('noindex', value === true)
            }
          >
            {t('builder.settings.visibility.noindex')}
          </Checkbox>
        </Field>

        {live ? (
          <Field role="group" aria-labelledby={`${id}-redirects`}>
            <span id={`${id}-redirects`} style={{ fontSize: 12, fontWeight: 600 }}>
              {t('builder.settings.redirects', { path: `/${live}` })}
            </span>
            {data.isRedirectsForbidden ? (
              <Typography variant="pi" textColor="neutral600">
                {t('builder.settings.redirects.forbidden')}
              </Typography>
            ) : data.redirects === undefined ? null : data.redirects.length === 0 ? (
              <Typography variant="pi" textColor="neutral600">
                {t('builder.settings.redirects.none')}
              </Typography>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {data.redirects.map((redirect) => (
                  <Row key={redirect.documentId}>
                    <code style={{ fontSize: 12 }}>
                      {redirect.from} → {redirect.to}
                    </code>
                    <Button
                      type="button"
                      size="S"
                      variant="danger-light"
                      disabled={props.isReadOnly}
                      aria-label={t('builder.settings.redirects.removeLabel', {
                        from: redirect.from,
                      })}
                      onClick={async () => {
                        setRemoval(
                          (await data.removeRedirect(redirect.documentId)) ? undefined : 'failed'
                        )
                      }}
                    >
                      {t('builder.settings.redirects.remove')}
                    </Button>
                  </Row>
                ))}
              </ul>
            )}
            {removal === 'failed' ? (
              <span role="alert" style={{ fontSize: 12, color: colors.danger700 }}>
                {t('builder.settings.redirects.removeFailed')}
              </span>
            ) : null}
          </Field>
        ) : null}
      </Body>
      <Foot>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          {props.onSaveAsTemplate ? (
            <Button
              type="button"
              variant="secondary"
              disabled={props.isDirty === true}
              aria-describedby={props.isDirty ? `${id}-template-unsaved` : undefined}
              onClick={props.onSaveAsTemplate}
            >
              {t('builder.settings.saveTemplate')}
            </Button>
          ) : null}
          <span
            role={outcome.kind === 'failed' ? 'alert' : 'status'}
            style={{
              fontSize: 12,
              color: outcome.kind === 'failed' ? colors.danger700 : colors.neutral600,
            }}
          >
            {status}
          </span>
          {props.onSaveAsTemplate && props.isDirty ? (
            <span id={`${id}-template-unsaved`} style={{ fontSize: 12, color: colors.neutral600 }}>
              {t('builder.settings.saveTemplate.unsaved')}
            </span>
          ) : null}
        </div>
        <Button type="button" onClick={props.onClose}>
          {t('builder.settings.done')}
        </Button>
      </Foot>
    </Panel>
  )
}
