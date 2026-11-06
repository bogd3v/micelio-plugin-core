import { Box, Button, Flex, Link, Typography } from '@strapi/design-system'
import { useFetchClient } from '@strapi/strapi/admin'
import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'

import { useLoaded } from '../hooks/useAsync'
import { hasMessage, useMessages } from '../messages'
import {
  allowedIn,
  pageTypeLabel,
  blockName,
  compareCost,
  editPath,
  pageToMeasure,
  type BlockUsage,
  type CatalogueBlock,
} from '../utils/blocks'
import { problemOf } from '../utils/fetchError'
import { Measurement, type Outcome } from './CostPanel'

interface DrawerProps {
  block: CatalogueBlock
  site: string
  pageTypes: string[]
  canManage: boolean
  /** Called after the settings were written, so the page reads them again. */
  onSaved: () => void
  onClose: () => void
}

/** What "Measure again" ended with. */
type Measured =
  { kind: 'ready'; measuredKb: number; page: BlockUsage } | { kind: 'error'; text: string }

const LOCALES = ['en', 'es'] as const

/**
 * The drawer of one block on the Block catalogue page: the page types it is allowed in, the options
 * a new block starts with, its label in the palette, its cost and the pages that use it.
 *
 * @remarks
 * Nothing in it runs until it is opened, and the frontend is only asked when **Measure again** is
 * pressed (it renders one page that holds the block, with the editor's own preview grant). The
 * contract itself is not editable here.
 */
export function BlockDrawer({ block, site, pageTypes, canManage, onSaved, onClose }: DrawerProps) {
  const { t, kb } = useMessages()
  const { locale } = useIntl()
  const client = useFetchClient()
  const heading = useRef<HTMLHeadingElement>(null)
  const name = blockName(block, locale)
  const [allowed, setAllowed] = useState<string[]>(allowedIn(block, pageTypes))
  const [defaults, setDefaults] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(block.options).map(([option, { default: value }]) => [option, value])
    )
  )
  const [labels, setLabels] = useState<Record<string, string>>({
    en: block.labels.en ?? '',
    es: block.labels.es ?? '',
  })
  const [problem, setProblem] = useState<string>()
  const [isSaving, setIsSaving] = useState(false)
  const [run, setRun] = useState(0)
  const [isMeasuring, setIsMeasuring] = useState(false)
  const [measured, setMeasured] = useState<Measured>()
  const usage = useLoaded<BlockUsage[]>(
    `/micelio/block-settings/${block.id}/usage?site=${encodeURIComponent(site)}`
  )
  const target = usage.resource.kind === 'ready' ? pageToMeasure(usage.resource.data) : undefined

  useEffect(() => {
    heading.current?.focus()
  }, [block.id])

  const write = async (body: Record<string, unknown>) => {
    setIsSaving(true)
    setProblem(undefined)
    try {
      await client.put(`/micelio/block-settings/${block.id}?site=${encodeURIComponent(site)}`, body)
      onSaved()
    } catch (error) {
      setProblem(problemOf(error)?.detail ?? t('blocks.error.save'))
    } finally {
      setIsSaving(false)
    }
  }

  const save = () =>
    write({
      // Every page type chosen is the core's default: store nothing, so a page type added later is allowed too.
      allowedPageTypes: pageTypes.every((type) => allowed.includes(type)) ? null : allowed,
      defaultOptions: Object.fromEntries(
        Object.entries(defaults).filter(
          ([option, value]) => value !== block.options[option]?.coreDefault
        )
      ),
      labels: Object.fromEntries(LOCALES.map((code) => [code, labels[code] ?? ''])),
    })

  const measure = () => {
    setMeasured(undefined)
    setIsMeasuring(true)
    setRun((value) => value + 1)
  }
  const settle = (page: BlockUsage) => (outcome: Outcome) => {
    setIsMeasuring(false)
    if (outcome.kind === 'error') return setMeasured({ kind: 'error', text: outcome.text })
    const found = outcome.measurement.blocks.find((entry) => entry.id === block.id)
    setMeasured(
      found
        ? { kind: 'ready', measuredKb: found.kb, page }
        : { kind: 'error', text: 'blocks.measure.notFound' }
    )
  }

  const compared =
    measured?.kind === 'ready' ? compareCost(block.costKb, measured.measuredKb) : undefined

  return (
    <Box
      tag="aside"
      aria-labelledby="block-drawer-title"
      data-testid="block-drawer"
      background="neutral0"
      borderColor="neutral200"
      hasRadius
      padding={6}
      shadow="filterShadow"
      onKeyDown={(event: React.KeyboardEvent) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <Flex direction="column" alignItems="stretch" gap={5}>
        <Flex justifyContent="space-between" alignItems="flex-start" gap={4}>
          <Flex direction="column" alignItems="flex-start" gap={1}>
            <Typography variant="beta" tag="h2" id="block-drawer-title" ref={heading} tabIndex={-1}>
              {name}
            </Typography>
            <Typography tag="p" textColor="neutral600">
              <code>{block.component}</code> · {site}
            </Typography>
          </Flex>
          <Button variant="tertiary" size="S" onClick={onClose}>
            {t('blocks.drawer.close')}
          </Button>
        </Flex>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={!canManage || isSaving}>
          <legend>
            <Typography variant="delta" tag="span">
              {t('blocks.drawer.pageTypes')}
            </Typography>
          </legend>
          <Flex direction="column" alignItems="flex-start" gap={1} paddingTop={2}>
            {pageTypes.map((type) => (
              <label key={type} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={allowed.includes(type)}
                  onChange={(event) =>
                    setAllowed((current) =>
                      event.target.checked
                        ? [...current, type]
                        : current.filter((other) => other !== type)
                    )
                  }
                />
                <Typography tag="span">{pageTypeLabel(type, t, hasMessage)}</Typography>
                <Typography tag="span" textColor="neutral600">
                  {t('blocks.drawer.coreDefault', { value: t('blocks.yes') })}
                </Typography>
              </label>
            ))}
          </Flex>
        </fieldset>

        <Flex direction="column" alignItems="stretch" gap={3}>
          <Typography variant="delta" tag="h3">
            {t('blocks.drawer.defaults')}
          </Typography>
          {Object.keys(block.options).length === 0 ? (
            <Typography textColor="neutral600">{t('blocks.drawer.noOptions')}</Typography>
          ) : (
            Object.entries(block.options).map(([option, { values, coreDefault }]) => (
              <fieldset
                key={option}
                style={{ border: 0, padding: 0, margin: 0 }}
                disabled={!canManage || isSaving}
              >
                <legend>
                  <Typography fontWeight="bold" tag="span">
                    {option}
                  </Typography>{' '}
                  <Typography tag="span" textColor="neutral600">
                    · {t('blocks.drawer.coreDefaultIs', { value: coreDefault })}
                  </Typography>
                </legend>
                <Flex gap={3} paddingTop={1} wrap="wrap">
                  {values.map((value) => (
                    <label key={value} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        type="radio"
                        name={`default-${option}`}
                        value={value}
                        checked={defaults[option] === value}
                        onChange={() => setDefaults((current) => ({ ...current, [option]: value }))}
                      />
                      <Typography tag="span">{value}</Typography>
                    </label>
                  ))}
                </Flex>
              </fieldset>
            ))
          )}
          <Typography variant="pi" textColor="neutral600">
            {t('blocks.drawer.defaults.note')}
          </Typography>
        </Flex>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={!canManage || isSaving}>
          <legend>
            <Typography variant="delta" tag="span">
              {t('blocks.drawer.label')}
            </Typography>
          </legend>
          <Flex gap={3} paddingTop={2} wrap="wrap">
            {LOCALES.map((code) => (
              <label key={code} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Typography variant="pi" textColor="neutral600" tag="span">
                  {code === 'en' ? t('blocks.drawer.label.en') : t('blocks.drawer.label.es')}
                </Typography>
                <input
                  type="text"
                  maxLength={60}
                  value={labels[code]}
                  placeholder={blockName({ id: block.id, labels: {} }, code)}
                  onChange={(event) =>
                    setLabels((current) => ({ ...current, [code]: event.target.value }))
                  }
                  style={{ padding: 8, minWidth: 200 }}
                />
              </label>
            ))}
          </Flex>
        </fieldset>

        <Flex direction="column" alignItems="flex-start" gap={2}>
          <Typography variant="delta" tag="h3">
            {t('blocks.drawer.cost')}
          </Typography>
          <Button variant="secondary" size="S" onClick={measure} disabled={isMeasuring || !target}>
            {t('blocks.drawer.measure')}
          </Button>
          <Typography tag="p" textColor="neutral700" data-testid="block-cost">
            {measured?.kind === 'ready' && compared
              ? t(`blocks.measure.${compared.kind}`, {
                  declared: kb(block.costKb),
                  measured: kb(measured.measuredKb),
                  page: measured.page.title,
                  difference: kb(compared.differenceKb),
                })
              : t('blocks.measure.declared', { declared: kb(block.costKb) })}
          </Typography>
          {isMeasuring ? <Typography role="status">{t('cost.loading')}</Typography> : null}
          {measured?.kind === 'error' ? (
            <Typography role="alert">{t(measured.text)}</Typography>
          ) : null}
          {usage.resource.kind === 'ready' && !target ? (
            <Typography variant="pi" textColor="neutral600">
              {t(
                usage.resource.data.length === 0
                  ? 'blocks.measure.noPage'
                  : 'blocks.measure.noMeasured'
              )}
            </Typography>
          ) : null}
          {run > 0 && isMeasuring && target ? (
            <Measurement
              key={run}
              entry={{
                uid: target.uid,
                documentId: target.documentId,
                locale: target.locale,
                version: target.updatedAt ?? undefined,
              }}
              onSettled={settle(target)}
            />
          ) : null}
        </Flex>

        <Flex direction="column" alignItems="flex-start" gap={2}>
          <Typography variant="delta" tag="h3">
            {t('blocks.drawer.usedIn', { count: block.used })}
          </Typography>
          {usage.resource.kind === 'loading' ? (
            <Typography textColor="neutral600">{t('blocks.loading')}</Typography>
          ) : usage.resource.kind === 'error' ? (
            <Typography role="alert">{t('blocks.error.usage')}</Typography>
          ) : usage.resource.data.length === 0 ? (
            <Typography textColor="neutral600">{t('blocks.drawer.unused')}</Typography>
          ) : (
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {usage.resource.data.map((page) => (
                <li key={`${page.uid}/${page.documentId}/${page.locale ?? ''}`}>
                  <Link href={`/admin${editPath(page)}`}>{page.title}</Link>{' '}
                  <Typography tag="span" textColor="neutral600">
                    · {t(`blocks.state.${page.state}`)}
                  </Typography>
                </li>
              ))}
            </ul>
          )}
        </Flex>

        <Typography variant="pi" textColor="neutral600">
          {t('blocks.drawer.contractNote')}
        </Typography>

        {problem ? (
          <Typography role="alert" textColor="danger700">
            {problem}
          </Typography>
        ) : null}
        {canManage ? (
          <Flex justifyContent="space-between" gap={2}>
            <Button
              variant="tertiary"
              disabled={isSaving}
              onClick={() => write({ allowedPageTypes: null, defaultOptions: null, labels: null })}
            >
              {t('blocks.drawer.reset')}
            </Button>
            <Button onClick={save} loading={isSaving}>
              {t('blocks.drawer.save')}
            </Button>
          </Flex>
        ) : (
          <Typography variant="pi" textColor="neutral600">
            {t('blocks.drawer.readOnly')}
          </Typography>
        )}
      </Flex>
    </Box>
  )
}
