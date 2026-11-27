import { Box, Flex, Link, Typography } from '@strapi/design-system'

import type { ThemeChange } from '../hooks/useThemeChange'
import { useMessages } from '../messages'
import { themeLabel, type ThemeRef } from '../utils/themes'
import { Notice } from './Notice'

/**
 * What happened to the activation or revert the page asked for, announced to a screen reader.
 *
 * @param origin - The site's frontend: while the page waits it links to it, because the frontend reads
 * a new pin only when it renders a page (`server/utils/site.ts` of `micelio`), so a site nobody visits
 * never switches.
 */
export function ThemeChangeNotice({
  change,
  origin,
}: {
  change: ThemeChange
  origin: string | null
}) {
  const { t } = useMessages()
  const name = (wanted: ThemeRef | null) => (wanted ? themeLabel(wanted) : t('themes.default'))
  const openSite = origin ? (
    <Link href={origin} isExternal>
      {t('themes.change.open')}
    </Link>
  ) : null
  switch (change.kind) {
    case 'idle':
      return null
    case 'sending':
      return (
        <Typography role="status" tag="p">
          {t(change.action === 'activate' ? 'themes.change.sending' : 'themes.change.reverting')}
        </Typography>
      )
    case 'refused':
      return (
        <Notice
          role="alert"
          text={
            change.code === 'themeRebuildRequired'
              ? t('themes.change.rebuild')
              : change.code === 'themeChangeLimited'
                ? t('themes.change.limited')
                : (change.detail ?? t('themes.change.failed'))
          }
        />
      )
    case 'waiting':
      return (
        <Flex gap={2} alignItems="baseline" wrap="wrap" marginBottom={2}>
          <Typography role="status" tag="p">
            {t('themes.change.waiting', { theme: name(change.wanted) })}
          </Typography>
          {openSite}
        </Flex>
      )
    case 'done':
      return (
        <Box padding={3} marginBottom={2} background="success100" hasRadius role="status">
          <Typography>{t('themes.change.done', { theme: name(change.wanted) })}</Typography>
        </Box>
      )
    case 'failed':
      return (
        <Notice
          role="alert"
          text={t('themes.change.refusedByFrontend', {
            theme: name(change.wanted),
            message: change.message,
          })}
        />
      )
    case 'slow':
      return (
        <Notice role="status" text={t('themes.change.slow', { theme: name(change.wanted) })}>
          {openSite}
        </Notice>
      )
  }
}
