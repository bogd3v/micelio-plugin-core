import { Flex, IconButton, Typography } from '@strapi/design-system'
import styled from 'styled-components'

import { useMessages } from '../../messages'
import { SOCIAL_NETWORKS, isLinkUrl, type SocialLink } from '../../utils/customize'
import { SelectInput, TextInput } from './fields'

const LinkRow = styled.div`
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr) 32px;
  gap: ${({ theme }) => theme.spaces[2]};
  align-items: start;
`

/** The artboard's dashed **+ Add a link**, the width of the card. */
const AddLink = styled.button`
  all: unset;
  box-sizing: border-box;
  width: 100%;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spaces[1]};
  border: 1px dashed ${({ theme }) => theme.colors.neutral300};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral100};
  color: ${({ theme }) => theme.colors.primary600};
  font-size: ${({ theme }) => theme.fontSizes[2]};
  font-weight: 600;
  cursor: pointer;
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
`

/** The artboard's "×" of a row (drawn here: `@strapi/icons` is not loadable in Node). */
function CrossIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The rows of the Social links card: the network from the enumeration of
 * `micelio-site.social-link` only, the URL with its pattern, and **Remove**; **Add a link** adds a
 * row. A URL outside the pattern says so under its field.
 */
export function SocialLinks(props: {
  links: SocialLink[]
  isReadOnly: boolean
  onChange: (links: SocialLink[]) => void
}) {
  const { t } = useMessages()
  const { links, isReadOnly, onChange } = props
  const change = (index: number, patch: Partial<SocialLink>) =>
    onChange(links.map((link, at) => (at === index ? { ...link, ...patch } : link)))
  return (
    <>
      {links.length === 0 ? (
        <Typography textColor="neutral600">{t('customize.social.none')}</Typography>
      ) : null}
      {links.map((link, index) => (
        <LinkRow
          key={index}
          role="group"
          aria-label={t('customize.social.link', { position: index + 1 })}
        >
          <SelectInput
            aria-label={t('customize.social.network')}
            value={link.network}
            disabled={isReadOnly}
            onChange={(event) => change(index, { network: event.target.value })}
          >
            {SOCIAL_NETWORKS.map((network) => (
              <option key={network} value={network}>
                {network}
              </option>
            ))}
          </SelectInput>
          <Flex direction="column" alignItems="stretch" gap={1}>
            <TextInput
              type="url"
              aria-label={t('customize.social.url')}
              value={link.url}
              readOnly={isReadOnly}
              aria-invalid={!isLinkUrl(link.url)}
              placeholder="https://"
              onChange={(event) => change(index, { url: event.target.value })}
            />
            {isLinkUrl(link.url) ? null : (
              <Typography variant="pi" textColor="danger600">
                {t('customize.url.invalid')}
              </Typography>
            )}
          </Flex>
          {isReadOnly ? (
            <span />
          ) : (
            <IconButton
              variant="danger-light"
              label={t('customize.social.remove', { network: link.network })}
              withTooltip={false}
              onClick={() => onChange(links.filter((_, at) => at !== index))}
            >
              <CrossIcon />
            </IconButton>
          )}
        </LinkRow>
      ))}
      {isReadOnly ? null : (
        <AddLink
          type="button"
          onClick={() =>
            onChange([...links, { network: SOCIAL_NETWORKS[0] ?? 'website', url: '' }])
          }
        >
          <span aria-hidden="true">+</span>
          {t('customize.social.add')}
        </AddLink>
      )}
      <Typography variant="pi" textColor="neutral600">
        {t('customize.social.help', { networks: SOCIAL_NETWORKS.join(', ') })}
      </Typography>
    </>
  )
}
