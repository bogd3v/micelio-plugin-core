import { Box, Flex, Typography } from '@strapi/design-system'
import type { ReactNode } from 'react'
import styled from 'styled-components'

/** A text input of the Customize page, in the Design System's look (the artboard's fields). */
export const TextInput = styled.input`
  box-sizing: border-box;
  width: 100%;
  height: 40px;
  padding: 0 ${({ theme }) => theme.spaces[4]};
  font: inherit;
  font-size: ${({ theme }) => theme.fontSizes[2]};
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};

  &:read-only {
    color: ${({ theme }) => theme.colors.neutral600};
    background: ${({ theme }) => theme.colors.neutral150};
  }
  &[aria-invalid='true'] {
    border-color: ${({ theme }) => theme.colors.danger600};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
`

/** A multi-line text input of the Customize page. */
export const TextArea = styled.textarea`
  box-sizing: border-box;
  width: 100%;
  padding: ${({ theme }) => `${theme.spaces[2]} ${theme.spaces[4]}`};
  font: inherit;
  font-size: ${({ theme }) => theme.fontSizes[2]};
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  resize: vertical;

  &:read-only {
    color: ${({ theme }) => theme.colors.neutral600};
    background: ${({ theme }) => theme.colors.neutral150};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
`

/** A native select of the Customize page: its options are the enumeration's, and nothing else. */
export const SelectInput = styled.select`
  box-sizing: border-box;
  width: 100%;
  height: 40px;
  padding: 0 ${({ theme }) => theme.spaces[3]};
  font: inherit;
  font-size: ${({ theme }) => theme.fontSizes[2]};
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};

  &:disabled {
    color: ${({ theme }) => theme.colors.neutral600};
    background: ${({ theme }) => theme.colors.neutral150};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
`

/** A labelled field: the label, the control, and a help line or an error under it. */
export function Field(props: {
  id: string
  label: string
  help?: string
  error?: string
  isRequired?: boolean
  children: ReactNode
}) {
  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      <label htmlFor={props.id}>
        <Typography variant="pi" fontWeight="bold" tag="span">
          {props.label}
        </Typography>
        {props.isRequired ? (
          <Typography variant="pi" textColor="danger600" tag="span" aria-hidden="true">
            {' *'}
          </Typography>
        ) : null}
      </label>
      {props.children}
      {props.error ? (
        <Typography variant="pi" textColor="danger600" id={`${props.id}-error`}>
          {props.error}
        </Typography>
      ) : null}
      {props.help ? (
        <Typography variant="pi" textColor="neutral600" id={`${props.id}-help`}>
          {props.help}
        </Typography>
      ) : null}
    </Flex>
  )
}

/** A card of the page: a section with its heading over a divider (the artboard's cards). */
export function Card(props: { id: string; title: string; children: ReactNode }) {
  return (
    <Box
      tag="section"
      aria-labelledby={props.id}
      background="neutral0"
      hasRadius
      shadow="filterShadow"
    >
      <Box
        paddingTop={4}
        paddingBottom={4}
        paddingLeft={5}
        paddingRight={5}
        borderColor="neutral150"
        borderStyle="solid"
        borderWidth="0 0 1px 0"
      >
        <Typography variant="delta" tag="h2" id={props.id}>
          {props.title}
        </Typography>
      </Box>
      <Flex direction="column" alignItems="stretch" gap={4} padding={5}>
        {props.children}
      </Flex>
    </Box>
  )
}
