import type { ReactNode } from 'react'
import styled, { useTheme } from 'styled-components'

const Label = styled.label`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
`

/** A line of help under a field. */
export const Help = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.neutral600};
`

/** A text area with the look of the panel's fields. */
export const Area = styled.textarea`
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  font: inherit;
  font-size: 14px;
  line-height: 1.4;
  resize: vertical;
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  &[aria-invalid='true'] {
    border-color: ${({ theme }) => theme.colors.danger600};
  }
`

/** A group of fields with a label of its own. */
export const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

/** A label with its counter on the right, and the field under it. */
export function Field(props: {
  label: string
  htmlFor: string
  counter?: string
  color?: string
  required?: boolean
  children: ReactNode
}) {
  const { colors } = useTheme()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Label htmlFor={props.htmlFor}>
        <span>
          {props.label}
          {props.required ? (
            <span aria-hidden="true" style={{ color: colors.danger600 }}>
              {' '}
              *
            </span>
          ) : null}
        </span>
        {props.counter ? (
          <span
            style={{ fontSize: 12, fontWeight: 400, color: props.color }}
            aria-live="polite"
            data-testid={`${props.htmlFor}-counter`}
          >
            {props.counter}
          </span>
        ) : null}
      </Label>
      {props.children}
    </div>
  )
}
