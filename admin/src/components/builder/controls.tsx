import styled from 'styled-components'

/** A square icon button of a panel's toolbar. */
export const Tool = styled.button<{ $isDanger?: boolean }>`
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

/** One choice of a row of exclusive choices; `$isPressed` marks the one chosen. */
export const Segment = styled.button<{ $isPressed: boolean }>`
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

/** A single-line text field in the builder's panels. */
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
`
