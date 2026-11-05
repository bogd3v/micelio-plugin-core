import styled from 'styled-components'

/**
 * The page's motion tokens (the Motion artboard): three durations and three easings, as CSS
 * variables. With `prefers-reduced-motion` every duration is 1 ms and nothing travels; the state is
 * still shown by colour, text and position.
 */
export const Motion = styled.div`
  --m-fast: 120ms;
  --m-base: 200ms;
  --m-slow: 320ms;
  --m-ease: cubic-bezier(0.2, 0, 0, 1);
  --m-ease-out: cubic-bezier(0, 0, 0.2, 1);
  --m-ease-in: cubic-bezier(0.4, 0, 1, 1);
  --m-offset: 8px;
  @media (prefers-reduced-motion: reduce) {
    --m-fast: 1ms;
    --m-base: 1ms;
    --m-slow: 1ms;
    --m-offset: 0px;
  }
`
