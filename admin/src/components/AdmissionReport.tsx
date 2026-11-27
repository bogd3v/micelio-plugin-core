import { Box, Typography } from '@strapi/design-system'
import styled from 'styled-components'

import type { CatalogueReport } from '../../../server/src/types/themes'
import { useMessages } from '../messages'

// The summary is the report's Markdown, shown as written: the page renders no Markdown.
const Summary = styled.pre`
  margin: 0;
  white-space: pre-wrap;
  font: inherit;
`

/** The summary of a theme's admission report, folded under a disclosure: it is long. */
export function AdmissionReport({ report }: { report: CatalogueReport }) {
  const { t } = useMessages()
  if (!report.summary) return null
  return (
    <details>
      <Typography tag="summary" textColor="primary600" style={{ cursor: 'pointer' }}>
        {t('themes.report.open')}
      </Typography>
      <Box paddingTop={2}>
        <Typography textColor="neutral700">
          <Summary>{report.summary}</Summary>
        </Typography>
      </Box>
    </details>
  )
}
