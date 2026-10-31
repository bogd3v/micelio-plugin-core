import { Box, Button, Flex, Typography } from '@strapi/design-system'
import { Layouts, Page } from '@strapi/strapi/admin'
import { useState } from 'react'

import { ExportPanel } from '../components/ExportPanel'
import { ImportPanel } from '../components/ImportPanel'
import { useLoaded } from '../hooks/useAsync'
import { useMessages } from '../messages'
import { TRANSFER_PERMISSION } from '../permissions'

interface SiteOption {
  slug: string
  name: string
  isDefault: boolean
}

const NOTES = ['backups', 'moving', 'leaving'] as const

/** Export and import (issue #58): a whole site as one archive, and an archive into a site. */
export default function TransferPage() {
  const { t } = useMessages()
  return (
    <Page.Protect permissions={[TRANSFER_PERMISSION]}>
      <Page.Main>
        <Page.Title>{t('transfer.title')}</Page.Title>
        <Layouts.Header title={t('transfer.title')} subtitle={t('transfer.subtitle')} />
        <Layouts.Content>
          <TransferContent />
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  )
}

function TransferContent() {
  const { t } = useMessages()
  const sites = useLoaded<SiteOption[]>('/micelio/transfers/sites')
  const [chosen, setChosen] = useState<string | null>(null)
  if (sites.resource.kind === 'loading') return <Page.Loading>{t('transfer.loading')}</Page.Loading>
  if (sites.resource.kind === 'error') {
    return (
      <Flex direction="column" alignItems="flex-start" gap={2}>
        <Typography textColor="neutral600">{t('transfer.error')}</Typography>
        <Button variant="secondary" size="S" onClick={sites.reload}>
          {t('status.retry')}
        </Button>
      </Flex>
    )
  }
  const options = sites.resource.data
  const site = options.find(({ slug }) => slug === chosen) ?? options[0]
  if (!site) return <Typography textColor="neutral600">{t('transfer.noSites')}</Typography>

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <Flex direction="column" alignItems="flex-start" gap={1}>
        <label htmlFor="transfer-site">
          <Typography variant="sigma" textColor="neutral600" tag="span">
            {t('transfer.site')}
          </Typography>
        </label>
        <select
          id="transfer-site"
          value={site.slug}
          onChange={(event) => setChosen(event.target.value)}
          style={{ padding: 8, minWidth: 240 }}
        >
          {options.map(({ slug, name }) => (
            <option key={slug} value={slug}>
              {name} ({slug})
            </option>
          ))}
        </select>
      </Flex>
      <Flex gap={6} alignItems="flex-start" wrap="wrap">
        <Box flex="1" minWidth="320px">
          <ExportPanel key={site.slug} site={site.slug} siteName={site.name} />
        </Box>
        <Box flex="1" minWidth="320px">
          <ImportPanel site={site.slug} siteName={site.name} />
        </Box>
      </Flex>
      <Flex gap={6} alignItems="flex-start" wrap="wrap">
        {NOTES.map((note) => (
          <Box key={note} flex="1" minWidth="240px">
            <Typography variant="delta" tag="h2">
              {t(`transfer.note.${note}.title`)}
            </Typography>
            <Typography tag="p" textColor="neutral600">
              {t(`transfer.note.${note}`)}
            </Typography>
          </Box>
        ))}
      </Flex>
    </Flex>
  )
}
