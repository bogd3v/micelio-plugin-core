import styled from 'styled-components'

export const Shell = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.neutral100};
`

export const Columns = styled.div`
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
`

export const Centre = styled.section`
  flex: 999 1 360px;
  min-width: 0;
  padding: 24px;
  background: ${({ theme }) => theme.colors.neutral150};
`

export const StageBox = styled.div`
  position: relative;
  height: calc(100vh - 12rem);
  min-height: 32rem;
`

export const Toast = styled.div`
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: ${({ theme }) => theme.colors.success100};
  border: 1px solid ${({ theme }) => theme.colors.success200};
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.success700};
  font-size: 13px;
  transition:
    opacity var(--m-base) var(--m-ease-out),
    transform var(--m-base) var(--m-ease-out);
  @starting-style {
    opacity: 0;
    transform: translate(-50%, var(--m-offset));
  }
`
