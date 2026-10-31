import { Box, Flex, Typography } from '@strapi/design-system'
import type { ReactNode } from 'react'

/** A titled card of a Micelio page: the `h2` and its content. */
export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box tag="section" background="neutral0" hasRadius shadow="filterShadow" padding={6}>
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Typography variant="delta" tag="h2">
          {title}
        </Typography>
        {children}
      </Flex>
    </Box>
  )
}
