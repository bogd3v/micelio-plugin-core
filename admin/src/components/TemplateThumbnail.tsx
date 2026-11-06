import styled from 'styled-components'

import type { ThumbnailShape } from '../../../server/src/types/page-templates'

const Frame = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  box-sizing: border-box;
  padding: 18px;
  overflow: hidden;
  background: ${({ theme }) => theme.colors.neutral100};
`

const Bar = styled.div<{ $width?: string; $height?: number; $isStrong?: boolean }>`
  width: ${({ $width }) => $width ?? '100%'};
  height: ${({ $height }) => $height ?? 8}px;
  flex: none;
  border-radius: 3px;
  background: ${({ $isStrong, theme }) => ($isStrong ? theme.colors.neutral800 : theme.colors.neutral300)};
`

const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
`

const Card = styled.div`
  height: 34px;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  background: ${({ theme }) => theme.colors.neutral0};
`

const Pill = styled.div`
  width: 44px;
  height: 14px;
  border-radius: 7px;
  background: ${({ theme }) => theme.colors.neutral800};
`

/** What one block adds to the drawing: bars, cards or a media block, never the page's own content. */
function Shape({ shape }: { shape: ThumbnailShape }) {
  switch (shape) {
    case 'hero':
      return (
        <>
          <Bar $width="60%" $height={14} $isStrong />
          <Bar $width="80%" />
          <Pill />
        </>
      )
    case 'cards':
      return (
        <Cards>
          <Card />
          <Card />
          <Card />
        </Cards>
      )
    case 'list':
      return (
        <>
          <Bar $width="90%" />
          <Bar $width="75%" />
          <Bar $width="85%" />
        </>
      )
    case 'media':
      return <Card style={{ height: 44 }} />
    case 'cta':
      return (
        <>
          <Bar $width="50%" $height={12} $isStrong />
          <Pill />
        </>
      )
    case 'row':
      return <Bar $width="100%" $height={12} />
    default:
      return (
        <>
          <Bar $width="70%" $height={10} $isStrong />
          <Bar $width="95%" />
          <Bar $width="80%" />
        </>
      )
  }
}

/**
 * The thumbnail of a template (the Templates artboard): one shape for each block of its structure,
 * drawn from what the template holds and never from an image of a page.
 */
export function TemplateThumbnail({ shapes }: { shapes: readonly ThumbnailShape[] }) {
  return (
    <Frame aria-hidden="true" data-testid="template-thumbnail">
      {shapes.map((shape, index) => (
        <Shape key={`${shape}-${index}`} shape={shape} />
      ))}
    </Frame>
  )
}
