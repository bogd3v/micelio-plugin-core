import {
  Box,
  Button,
  Flex,
  Link,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system'
import { Layouts, Page } from '@strapi/strapi/admin'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'

import type { InReviewEntry, InReviewSite } from '../../../server/src/types/editorial'
import { SendBackDialog } from '../components/builder/ReviewDialogs'
import { useLoaded } from '../hooks/useAsync'
import { useTransition } from '../hooks/useTransition'
import { useMessages } from '../messages'
import { REVIEW_READ_PERMISSION } from '../permissions'
import { builderPath } from '../utils/review'

/**
 * The In review page (issue #57): the pages awaiting review, by site, with the reviewer's actions:
 * approve (publish) and send back with a note.
 *
 * @remarks
 * `GET /micelio/review` lists the entries of the types the user may read. Every action is a
 * transition the server decides (`POST /micelio/transitions`); a refusal is a notification with a
 * link to the block it names, in the builder.
 */
export default function ReviewPage() {
  return (
    <Page.Protect permissions={[REVIEW_READ_PERMISSION]}>
      <Review />
    </Page.Protect>
  )
}

function Review() {
  const { t } = useMessages()
  const sites = useLoaded<InReviewSite[]>('/micelio/review')
  const resource = sites.resource
  const count =
    resource.kind === 'ready'
      ? resource.data.reduce((sum, site) => sum + site.entries.length, 0)
      : 0
  return (
    <Page.Main>
      <Page.Title>{t('review.page.title')}</Page.Title>
      <Layouts.Header
        title={t('review.page.title')}
        subtitle={resource.kind === 'ready' ? t('review.page.subtitle', { count }) : undefined}
      />
      <Layouts.Content>
        {resource.kind === 'loading' ? <Page.Loading /> : null}
        {resource.kind === 'error' ? (
          <Flex direction="column" alignItems="flex-start" gap={2}>
            <Typography textColor="neutral600">{t('review.page.error')}</Typography>
            <Button variant="secondary" size="S" onClick={sites.reload}>
              {t('status.retry')}
            </Button>
          </Flex>
        ) : null}
        {resource.kind === 'ready' && count === 0 ? (
          <Typography textColor="neutral600">{t('review.page.empty')}</Typography>
        ) : null}
        {resource.kind === 'ready' ? (
          <Flex direction="column" alignItems="stretch" gap={6}>
            {resource.data.map((site) => (
              <SiteEntries key={site.documentId ?? ''} site={site} onChanged={sites.reload} />
            ))}
          </Flex>
        ) : null}
      </Layouts.Content>
    </Page.Main>
  )
}

function SiteEntries({ site, onChanged }: { site: InReviewSite; onChanged: () => void }) {
  const { t, date } = useMessages()
  return (
    <Box tag="section" aria-label={site.name}>
      <Typography tag="h2" variant="delta" fontWeight="bold">
        {site.name || t('review.page.noSite')}
      </Typography>
      <Box marginTop={3}>
        <Table colCount={4} rowCount={site.entries.length + 1}>
          <Thead>
            <Tr>
              <Th>
                <Typography variant="sigma">{t('review.page.entry')}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">{t('review.page.sent')}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">{t('review.page.note')}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">{t('review.page.actions')}</Typography>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {site.entries.map((entry) => (
              <Tr key={`${entry.uid}:${entry.documentId}:${entry.locale ?? ''}`}>
                <Td>
                  <Flex direction="column" alignItems="flex-start">
                    <Link tag={NavLink} to={builderPath(entry)}>
                      <Typography fontWeight="bold" textColor="primary600">
                        {entry.title}
                      </Typography>
                    </Link>
                    <Typography variant="pi" textColor="neutral600">
                      {[entry.kind, entry.locale].filter(Boolean).join(' · ')}
                    </Typography>
                  </Flex>
                </Td>
                <Td>
                  <Typography textColor="neutral600">
                    {entry.updatedAt ? date(entry.updatedAt) : ''}
                  </Typography>
                </Td>
                <Td style={{ whiteSpace: 'normal', maxWidth: 360 }}>
                  <Typography textColor={entry.note ? 'neutral800' : 'neutral600'}>
                    {entry.note ?? t('review.page.noNote')}
                  </Typography>
                </Td>
                <Td>
                  <EntryActions entry={entry} onChanged={onChanged} />
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Box>
    </Box>
  )
}

function EntryActions({ entry, onChanged }: { entry: InReviewEntry; onChanged: () => void }) {
  const { t } = useMessages()
  const { perform } = useTransition(entry)
  const [isSendingBack, setIsSendingBack] = useState(false)
  const [isWorking, setIsWorking] = useState(false)
  async function move(to: 'published' | 'draft', note?: string): Promise<boolean> {
    setIsWorking(true)
    try {
      const outcome = await perform(to, note === undefined ? {} : { note })
      if (outcome.ok) onChanged()
      return outcome.ok
    } finally {
      setIsWorking(false)
    }
  }
  return (
    <Flex gap={2}>
      <Button
        size="S"
        disabled={isWorking}
        onClick={() => void move('published')}
        aria-label={t('review.page.approveEntry', { title: entry.title })}
      >
        {t('review.page.approve')}
      </Button>
      <Button
        size="S"
        variant="tertiary"
        disabled={isWorking}
        onClick={() => setIsSendingBack(true)}
        aria-label={t('review.page.sendBackEntry', { title: entry.title })}
      >
        {t('review.action.sendBack')}
      </Button>
      {isSendingBack ? (
        <SendBackDialog
          onClose={() => setIsSendingBack(false)}
          onSendBack={(note) => move('draft', note)}
        />
      ) : null}
    </Flex>
  )
}
