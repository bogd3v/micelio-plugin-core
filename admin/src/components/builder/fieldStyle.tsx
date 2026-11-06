import styled from 'styled-components'

import { hasMessage } from '../../messages'

/** The style of the label of a field of the panel. */
export const labelStyle = (color: string) => ({ fontSize: 12, fontWeight: 600, color }) as const

/** The label of a field: the plugin's translation for the common names, else the name made readable. */
export function fieldLabel(name: string, t: (id: string) => string): string {
  const id = `builder.field.${name}`
  if (hasMessage(id)) return t(id)
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A line of text in the panel, with the field's look. */
export const Input = styled.input`
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
  &[data-sample='true'] {
    color: ${({ theme }) => theme.colors.neutral500};
    font-style: italic;
  }
  &:disabled {
    background: ${({ theme }) => theme.colors.neutral100};
    color: ${({ theme }) => theme.colors.neutral600};
  }
`
