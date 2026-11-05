import { Box, Typography } from '@strapi/design-system'
import type { ReactNode } from 'react'

/** A notice on a page of the plugin: a warning box that a screen reader announces as `role` says. */
export function Notice(props: {
  role: 'alert' | 'status'
  title?: string
  text: string
  children?: ReactNode
}) {
  return (
    <Box
      role={props.role}
      padding={3}
      marginBottom={2}
      background="warning100"
      borderColor="warning200"
      hasRadius
    >
      {props.title ? (
        <Typography fontWeight="bold" tag="p">
          {props.title}
        </Typography>
      ) : null}
      <Typography tag="p">{props.text}</Typography>
      {props.children ? <Box marginTop={3}>{props.children}</Box> : null}
    </Box>
  )
}
