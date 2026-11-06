import { Button, Modal, Radio, Typography, VisuallyHidden } from '@strapi/design-system'
import { useFetchClient } from '@strapi/strapi/admin'
import { useEffect, useId, useRef, useState } from 'react'
import styled, { useTheme } from 'styled-components'
import { useIntl } from 'react-intl'

import type { TemplateInspection } from '../../../server/src/types/page-templates'
import { useMessages } from '../messages'
import { pageTypeName, type PageTypeOption } from '../utils/builder/pageSettings'
import { nameOf, type CatalogueEntry } from '../utils/builder/palette'
import { ANSWER_REFUSALS, outcomeOf } from '../utils/fetchError'
import { optionsLine, type BlockChoice } from '../utils/templates'
import { Input } from './builder/fieldStyle'

const Select = styled.select`
  height: 40px;
  width: 100%;
  box-sizing: border-box;
  padding: 0 8px;
  font: inherit;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  &:disabled {
    background: ${({ theme }) => theme.colors.neutral100};
  }
`

const Label = styled.label`
  font-size: 12px;
  font-weight: 600;
`

const Pair = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
`

const Table = styled.div`
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  overflow: hidden;
`

const Row = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1.4fr) 56px;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  & + & {
    border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
  }
`

const Head = styled(Row)`
  background: ${({ theme }) => theme.colors.neutral100};
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.neutral600};
`

const Note = styled.div`
  padding: 12px;
  font-size: 12px;
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral100};
  color: ${({ theme }) => theme.colors.neutral700};
`

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const Help = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.neutral600};
`

interface SaveTemplateDialogProps {
  /** The page the template is made from. */
  page: { uid: string; documentId: string; locale: string | null; site: string }
  /** The catalogue of the page's site, for the names of the blocks. */
  entries: CatalogueEntry[]
  /** The page types the site offers with their budgets. */
  pageTypes: PageTypeOption[]
  onClose: () => void
  /** Called with the name of the template once it is saved. */
  onSaved: (name: string) => void
}

/**
 * The Save as template dialog (the Save as template artboard): what is kept block by block, the
 * scope, and the checks, which the server runs on every change of the scope, the page type or the
 * name and again when it saves.
 *
 * @remarks
 * A template copies, it never links: the dialog says so. The checks are the server's: it is the one
 * that refuses a save, so the dialog shows what it answers and never decides.
 */
export function SaveTemplateDialog(props: SaveTemplateDialogProps) {
  const { t, kb } = useMessages()
  const { locale: language } = useIntl()
  const id = useId()
  const { colors } = useTheme()
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [pageType, setPageType] = useState<string>()
  const [scope, setScope] = useState<'site' | 'cms'>('site')
  const [choices, setChoices] = useState<BlockChoice[]>([])
  const [inspection, setInspection] = useState<TemplateInspection>()
  const [failure, setFailure] = useState<string>()
  const [isSaving, setIsSaving] = useState(false)
  const { page } = props

  const query = `site=${encodeURIComponent(page.site)}`
  const body = (extra: object) => ({
    uid: page.uid,
    documentId: page.documentId,
    locale: page.locale,
    scope,
    pageTypes: pageType ? [pageType] : undefined,
    name,
    ...extra,
  })

  // The page the template is made from, and what the server finds in it, on every change of what
  // the checks read. The name is waited for, so typing does not ask for a check on every key.
  useEffect(() => {
    let isCurrent = true
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const outcome = outcomeOf<TemplateInspection>(
            await clientRef.current.post(
              `/micelio/templates/inspect?${query}`,
              body({}),
              ANSWER_REFUSALS
            )
          )
          if (!isCurrent) return
          if (!outcome.ok) {
            setFailure(outcome.detail ?? t('template.save.failed.read'))
            return
          }
          setFailure(undefined)
          setInspection(outcome.data)
          setPageType((current) => current ?? outcome.data.pageType)
          setChoices((current) =>
            current.length === outcome.data.blocks.length
              ? current
              : outcome.data.blocks.map(() => ({ content: 'sample', fixed: false }))
          )
        } catch {
          if (isCurrent) setFailure(t('template.save.failed.read'))
        }
      })()
    }, 250)
    return () => {
      isCurrent = false
      window.clearTimeout(timer)
    }
    // `body` is rebuilt on every render and reads exactly the values listed here.
  }, [page.uid, page.documentId, page.locale, query, scope, pageType, name])

  const nameOfBlock = (block: string) => {
    const entry = props.entries.find((candidate) => candidate.id === block)
    return entry ? nameOf(entry, language) : block
  }
  const setChoice = (index: number, change: Partial<BlockChoice>) =>
    setChoices((current) =>
      current.map((choice, at) => (at === index ? { ...choice, ...change } : choice))
    )

  async function save() {
    setIsSaving(true)
    setFailure(undefined)
    try {
      const outcome = outcomeOf<unknown>(
        await clientRef.current.post(
          `/micelio/templates?${query}`,
          body({ description, blocks: choices }),
          ANSWER_REFUSALS
        )
      )
      if (outcome.ok) {
        props.onSaved(name.trim())
        props.onClose()
      } else {
        setFailure(outcome.detail ?? t('template.save.failed'))
      }
    } catch {
      setFailure(t('template.save.failed'))
    } finally {
      setIsSaving(false)
    }
  }

  const types =
    props.pageTypes.length > 0 ? props.pageTypes : [{ id: pageType ?? 'standard', budgetKb: 0 }]
  const canSave = name.trim() !== '' && inspection !== undefined && !isSaving && choices.length > 0

  return (
    <Modal.Root open onOpenChange={(isOpen: boolean) => (isOpen ? undefined : props.onClose())}>
      <Modal.Content style={{ width: 'min(640px, 100vw)' }}>
        <Modal.Header closeLabel={t('template.save.close')}>
          <div>
            <Modal.Title>{t('template.save.title')}</Modal.Title>
            <Typography variant="pi" textColor="neutral600" tag="p">
              {inspection
                ? t('template.save.from', {
                    title: inspection.title,
                    count: inspection.blocks.length,
                    kb: kb(inspection.kb),
                  })
                : t('template.save.loading')}
            </Typography>
          </div>
        </Modal.Header>
        <Modal.Body>
          <Stack style={{ gap: 20 }}>
            <Pair>
              <Stack>
                <Label htmlFor={`${id}-name`}>
                  {t('template.save.name')}
                  <span aria-hidden="true"> *</span>
                </Label>
                <Input
                  id={`${id}-name`}
                  value={name}
                  required
                  maxLength={80}
                  aria-invalid={inspection?.checks.some(
                    (check) => check.id === 'name' && !check.ok
                  )}
                  onChange={(event) => setName(event.target.value)}
                />
              </Stack>
              <Stack>
                <Label htmlFor={`${id}-type`}>{t('template.save.pageTypes')}</Label>
                <Select
                  id={`${id}-type`}
                  value={pageType ?? ''}
                  onChange={(event) => setPageType(event.target.value)}
                >
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {pageTypeName(type.id)}
                    </option>
                  ))}
                </Select>
              </Stack>
            </Pair>
            <Stack>
              <Label htmlFor={`${id}-description`}>{t('template.save.description')}</Label>
              <Input
                id={`${id}-description`}
                value={description}
                maxLength={300}
                onChange={(event) => setDescription(event.target.value)}
              />
              <Help>{t('template.save.description.help')}</Help>
            </Stack>
            <Stack>
              <Label as="span" id={`${id}-kept`}>
                {t('template.save.kept')}
              </Label>
              <Table role="table" aria-labelledby={`${id}-kept`}>
                <Head role="row">
                  <span role="columnheader">{t('template.save.column.block')}</span>
                  <span role="columnheader">{t('template.save.column.content')}</span>
                  <span role="columnheader">{t('template.save.column.fixed')}</span>
                </Head>
                {(inspection?.blocks ?? []).map((block, index) => (
                  <Row role="row" key={`${block.block}-${index}`}>
                    <div role="cell">
                      <Typography tag="div">{nameOfBlock(block.block)}</Typography>
                      <Help>
                        {[
                          optionsLine(block.options),
                          block.items > 0 ? t('template.save.items', { count: block.items }) : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Help>
                    </div>
                    <div role="cell">
                      <Select
                        aria-label={t('template.save.contentOf', {
                          block: nameOfBlock(block.block),
                        })}
                        value={choices[index]?.content ?? 'sample'}
                        onChange={(event) =>
                          setChoice(index, {
                            content: event.target.value as BlockChoice['content'],
                          })
                        }
                      >
                        <option value="sample">{t('template.save.content.sample')}</option>
                        <option value="clear">{t('template.save.content.clear')}</option>
                      </Select>
                    </div>
                    <div role="cell">
                      <input
                        type="checkbox"
                        aria-label={t('template.save.fixedOf', { block: nameOfBlock(block.block) })}
                        checked={choices[index]?.fixed ?? false}
                        onChange={(event) => setChoice(index, { fixed: event.target.checked })}
                      />
                    </div>
                  </Row>
                ))}
              </Table>
              <Help>{t('template.save.kept.help')}</Help>
            </Stack>
            <Pair>
              <Stack as="fieldset" style={{ border: 0, padding: 0, margin: 0 }}>
                <Label as="legend">{t('template.save.scope')}</Label>
                <Radio.Group
                  value={scope}
                  name={`${id}-scope`}
                  onValueChange={(value: string) => setScope(value === 'cms' ? 'cms' : 'site')}
                >
                  <Radio.Item value="site">
                    {t('template.save.scope.site', { site: inspection?.siteName ?? page.site })}
                  </Radio.Item>
                  <Radio.Item value="cms">{t('template.save.scope.cms')}</Radio.Item>
                </Radio.Group>
                <Help>{t('template.save.scope.help')}</Help>
              </Stack>
              <Stack>
                <Label as="span">{t('template.save.checks')}</Label>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-live="polite">
                  {(inspection?.checks ?? []).map((check) => (
                    <li
                      key={check.id}
                      style={{
                        fontSize: 13,
                        color: check.ok ? colors.success700 : colors.danger700,
                      }}
                    >
                      <span aria-hidden="true">{check.ok ? '✓' : '✗'} </span>
                      <VisuallyHidden>
                        {check.ok ? t('template.save.check.ok') : t('template.save.check.bad')}{' '}
                      </VisuallyHidden>
                      {check.detail}
                    </li>
                  ))}
                </ul>
              </Stack>
            </Pair>
            <Note>
              <strong>{t('template.save.copy.title')}</strong> {t('template.save.copy.body')}
            </Note>
            {failure ? (
              <Typography role="alert" textColor="danger700">
                {failure}
              </Typography>
            ) : null}
          </Stack>
        </Modal.Body>
        <Modal.Footer>
          <Typography variant="pi" textColor="neutral600">
            {t('template.save.footer')}
          </Typography>
          <div style={{ display: 'flex', gap: 8 }}>
            <Modal.Close>
              <Button variant="tertiary">{t('template.save.cancel')}</Button>
            </Modal.Close>
            <Button onClick={() => void save()} disabled={!canSave} loading={isSaving}>
              {t('template.save.submit')}
            </Button>
          </div>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  )
}
