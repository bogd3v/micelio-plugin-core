import styled from 'styled-components'

/**
 * The width from which the builder's and the template editor's three columns sit side by side:
 * their flex bases, 264 px (`LeftColumn`), 360 px (`Centre`) and 320 px (the block panel).
 */
export const BUILDER_COLUMNS_PX = 944

/**
 * A style for an editor whose columns sit side by side: a container query on the width of the
 * admin's main area, which `Shell` makes the container `micelio-editor`.
 */
export const sideBySide = (from: number) => `@container micelio-editor (min-width: ${from}px)`

/** The columns of an editor, side by side where they fit and wrapped where they do not. */
export const Columns = styled.div`
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
`

/**
 * The page of an editor. With `$from`, the width at which its columns sit side by side, it fills
 * the admin's main area and never grows past it: the top bar stays, and each child of `Columns`
 * scrolls on its own. Narrower, the columns wrap and the page scrolls.
 *
 * @remarks
 * The admin scrolls its main area (`data-strapi-main-content`), not the document. While it holds an
 * editor, that area is the size container the editor's height comes from, with no bottom padding.
 */
export const Shell = styled.div<{ $from?: number }>`
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.neutral100};

  [data-strapi-main-content]:has(&) {
    container: micelio-editor / size;
    padding-bottom: 0;
  }

  ${({ $from }) =>
    $from === undefined
      ? ''
      : `${sideBySide($from)} {
          height: 100cqh;
          min-height: 0;
          > ${Columns} {
            flex-wrap: nowrap;
            min-height: 0;
          }
          > ${Columns} > * {
            /* What a column positions (visually hidden text) scrolls with it, not with the page. */
            position: relative;
            min-height: 0;
            overflow-y: auto;
          }
        }`}
`

/** The builder's and the template editor's left column: the palette over the page's block list. */
export const LeftColumn = styled.div`
  flex: 0 1 264px;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.neutral0};
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

/**
 * The builder's preview pane: a column while its three columns sit side by side, so the frame's box
 * shrinks to what the pane has left, down to its 32 rem, and the pane does not scroll for it: it
 * holds no control a keyboard could scroll it by.
 */
export const BuilderPane = styled(Centre)`
  ${sideBySide(BUILDER_COLUMNS_PX)} {
    display: flex;
    flex-direction: column;
  }
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
