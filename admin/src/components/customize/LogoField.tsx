import { Button, Flex, Typography } from '@strapi/design-system'
import { useStrapiApp } from '@strapi/strapi/admin'
import { useId, useState, type ComponentType } from 'react'
import styled from 'styled-components'

import { useMessages } from '../../messages'
import type { LogoFile } from '../../utils/customize'
import { srcOf } from '../builder/MediaInputs'

/** What the Media Library dialog of the Strapi admin takes (`components/builder/MediaInputs.tsx`). */
interface DialogProps {
  allowedTypes?: string[]
  multiple?: boolean
  onClose: () => void
  onSelectAssets: (
    files: { id: number; name?: string; url?: string; alternativeText?: string | null }[]
  ) => void
}

const Thumb = styled.div`
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: ${({ theme }) => theme.borderRadius};
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  background: ${({ theme }) => theme.colors.neutral100};
  & > img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
`

/**
 * The logo of the site: its thumbnail and name, picked in Strapi's own Media Library dialog as
 * `MediaInputs` picks a file (`components['media-library']`), so folders, files and permissions are
 * the Media Library's; the page never uploads.
 */
export function LogoField(props: {
  logo: LogoFile | null
  isReadOnly: boolean
  onChange: (logo: LogoFile | null) => void
}) {
  const { t } = useMessages()
  const id = useId()
  const components = useStrapiApp('LogoField', (state) => state.components)
  const Dialog = components['media-library'] as ComponentType<DialogProps> | undefined
  const [isOpen, setIsOpen] = useState(false)
  const { logo } = props
  const thumb = srcOf(logo?.url)
  return (
    <Flex
      direction="column"
      alignItems="stretch"
      gap={2}
      role="group"
      aria-labelledby={`${id}-label`}
    >
      <Typography variant="pi" fontWeight="bold" tag="span" id={`${id}-label`}>
        {t('customize.logo')}
      </Typography>
      <Flex gap={3} alignItems="center">
        <Thumb>{logo && thumb ? <img src={thumb} alt="" /> : null}</Thumb>
        <Flex direction="column" alignItems="flex-start" gap={1}>
          <Typography variant="pi" data-testid="customize-logo">
            {logo ? logo.name : t('customize.logo.none')}
          </Typography>
          {props.isReadOnly ? null : (
            <Flex gap={2}>
              <Button
                variant="secondary"
                size="S"
                onClick={() => setIsOpen(true)}
                disabled={!Dialog}
              >
                {t(logo ? 'customize.logo.replace' : 'customize.logo.choose')}
              </Button>
              {logo ? (
                <Button
                  variant="tertiary"
                  size="S"
                  aria-label={t('customize.logo.remove')}
                  onClick={() => props.onChange(null)}
                >
                  {t('customize.logo.removeShort')}
                </Button>
              ) : null}
            </Flex>
          )}
        </Flex>
      </Flex>
      {isOpen && Dialog ? (
        <Dialog
          allowedTypes={['images']}
          multiple={false}
          onClose={() => setIsOpen(false)}
          onSelectAssets={(files) => {
            const [file] = files
            if (file) {
              props.onChange({
                id: file.id,
                name: file.name ?? String(file.id),
                url: file.url ?? '',
                alternativeText: file.alternativeText ?? null,
              })
            }
            setIsOpen(false)
          }}
        />
      ) : null}
    </Flex>
  )
}
