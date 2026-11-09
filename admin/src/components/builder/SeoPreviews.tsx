import { useState } from 'react'
import styled, { useTheme } from 'styled-components'

import { useMessages } from '../../messages'
import { breadcrumbOf } from '../../utils/builder/seo'
import { Segment } from './controls'
import { Section } from './SeoFields'

const Frame = styled.div`
  padding: 12px;
  border: 1px solid ${({ theme }) => theme.colors.neutral150};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.neutral0};
`

type Preview = 'search' | 'card' | 'fediverse'
const PREVIEWS: readonly Preview[] = ['search', 'card', 'fediverse']

/**
 * The three previews of the SEO and social tab (the Page settings artboard, 5b): the page in a
 * search result, as a link card and as a fediverse post, drawn from the fields as they are typed.
 */
export function SeoPreviews(props: {
  host: string
  slug: string
  siteName: string
  title: string
  description: string
  /** The social image's address, or `undefined` for a page that has none. */
  image: string | undefined
}) {
  const { colors } = useTheme()
  const { t } = useMessages()
  const [preview, setPreview] = useState<Preview>('search')
  const { title, description, host } = props
  const site = props.siteName
  return (
    <Section>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{t('seo.preview')}</span>
      <div
        role="group"
        aria-label={t('seo.preview.tabs')}
        style={{ display: 'inline-flex', alignSelf: 'flex-start' }}
      >
        {PREVIEWS.map((name) => (
          <Segment
            key={name}
            type="button"
            $isPressed={preview === name}
            aria-pressed={preview === name}
            style={{ textTransform: 'none', height: 32, flex: 'none', whiteSpace: 'nowrap' }}
            onClick={() => setPreview(name)}
          >
            {t(`seo.preview.${name}`)}
          </Segment>
        ))}
      </div>
      <Frame data-testid={`seo-preview-${preview}`}>
        {preview === 'search' ? (
          <>
            <div style={{ fontSize: 11, color: colors.neutral600 }}>
              {breadcrumbOf(host, props.slug)}
            </div>
            <div style={{ fontSize: 16, color: colors.primary700, margin: '2px 0' }}>
              {title || t('seo.preview.untitled')}
            </div>
            <div style={{ fontSize: 13, color: colors.neutral800 }}>
              {description || t('seo.preview.noDescription')}
            </div>
          </>
        ) : preview === 'card' ? (
          <LinkCard host={host} title={title} description={description} image={props.image} />
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            <div
              aria-hidden="true"
              style={{
                flex: 'none',
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: colors.primary200,
              }}
            />
            <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13 }}>
                <strong>{site}</strong> <span style={{ color: colors.neutral600 }}>@{host}</span>
              </div>
              <div style={{ fontSize: 13 }}>
                {t('seo.preview.fediverseText', {
                  site,
                  title: title || t('seo.preview.untitled'),
                })}
              </div>
              <LinkCard host={host} title={title} description={description} image={props.image} />
            </div>
          </div>
        )}
      </Frame>
    </Section>
  )
}

/** The page as a link card: image on top, host, title and description. */
function LinkCard(props: {
  host: string
  title: string
  description: string
  image: string | undefined
}) {
  const { colors } = useTheme()
  const { t } = useMessages()
  return (
    <div style={{ border: `1px solid ${colors.neutral200}`, borderRadius: 6, overflow: 'hidden' }}>
      <div
        style={{
          aspectRatio: '1200 / 630',
          background: colors.neutral150,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          color: colors.neutral600,
        }}
      >
        {props.image ? (
          <img
            src={props.image}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          t('seo.preview.noImage')
        )}
      </div>
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 11, color: colors.neutral600, textTransform: 'uppercase' }}>
          {props.host}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {props.title || t('seo.preview.untitled')}
        </span>
        <span style={{ fontSize: 12, color: colors.neutral600 }}>{props.description}</span>
      </div>
    </div>
  )
}
