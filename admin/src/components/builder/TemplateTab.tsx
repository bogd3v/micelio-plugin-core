import { Button, Typography } from '@strapi/design-system'
import { useFetchClient } from '@strapi/strapi/admin'
import { useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import styled, { useTheme } from 'styled-components'

import type {
  TemplateOffer,
  TemplateSummary,
  TemplateSwitchPlan,
} from '../../../../server/src/types/page-templates'
import { useLoaded } from '../../hooks/useAsync'
import { useMessages } from '../../messages'
import { ANSWER_REFUSALS, outcomeOf } from '../../utils/fetchError'
import { changeLine } from '../../utils/templateChanges'
import { TemplateThumbnail } from '../TemplateThumbnail'

const Card = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid ${({ theme }) => theme.colors.neutral150};
  border-radius: 6px;
`

const Thumb = styled.div`
  flex: none;
  width: 72px;
  height: 56px;
  overflow: hidden;
  border-radius: 4px;
`

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
`

const Line = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const Tag = styled.span`
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.neutral700};
  background: ${({ theme }) => theme.colors.neutral150};
`

const Action = styled.button`
  all: unset;
  box-sizing: border-box;
  display: block;
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.neutral100};
  }
  &:disabled {
    cursor: not-allowed;
    color: ${({ theme }) => theme.colors.neutral500};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
`

const Select = styled.select`
  height: 40px;
  padding: 0 8px;
  font: inherit;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
`

interface TemplateTabProps {
  /** The page the settings belong to. */
  page: { uid: string; documentId: string; locale: string | null; site: string }
  /** The name of a block of the site's catalogue, by its id. */
  blockName: (id: string) => string
  /** Whether the role may manage templates: detach and save as a new template are theirs. */
  canManage: boolean
  isReadOnly: boolean
  /** The page has changes the CMS does not hold yet; the actions work on what it holds. */
  isDirty: boolean
  /** Opens the Save as template dialog. */
  onSaveAsTemplate: () => void
  /** The page was changed on the server: the builder reads it again. */
  onChanged: () => void
}

type Switching =
  | { kind: 'idle' }
  | { kind: 'choosing' }
  | { kind: 'planned'; to: TemplateSummary; plan: TemplateSwitchPlan }

/**
 * The Template tab of the page settings (the Page settings artboard, 5b): the template and version
 * the page started from, what changed since and the offer to apply it, the blocks the template
 * fixed, and the actions that move the page to another template, detach it or save it as one.
 *
 * @remarks
 * Applying is an offer: nothing changes until the editor presses **Apply the structure changes**.
 * **Keep** only closes the offer for this visit. A page made without a template shows the save
 * action alone.
 */
export function TemplateTab(props: TemplateTabProps) {
  const { colors } = useTheme()
  const { t } = useMessages()
  const { formatDate } = useIntl()
  const { page, blockName } = props
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const query = `uid=${encodeURIComponent(page.uid)}&documentId=${encodeURIComponent(page.documentId)}${
    page.locale ? `&locale=${encodeURIComponent(page.locale)}` : ''
  }`
  const offered = useLoaded<TemplateOffer>(`/micelio/templates/offer?${query}`)
  const [isKept, setIsKept] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [switching, setSwitching] = useState<Switching>({ kind: 'idle' })
  const choices = useLoaded<TemplateSummary[]>(
    switching.kind === 'idle'
      ? null
      : `/micelio/templates?site=${encodeURIComponent(page.site)}&uid=${encodeURIComponent(page.uid)}`
  )

  if (offered.resource.kind === 'loading') {
    return <Typography textColor="neutral600">{t('template.tab.loading')}</Typography>
  }
  if (offered.resource.kind === 'error') {
    return (
      <Typography role="alert" textColor="danger700">
        {t('template.tab.error')}
      </Typography>
    )
  }
  const offer = offered.resource.data
  const template = offer.template
  const isBehind = template !== null && offer.version !== null && offer.version < template.version
  const isLocked = props.isReadOnly || props.isDirty || isBusy

  async function send<T>(path: string, body: Record<string, unknown>): Promise<T | undefined> {
    setIsBusy(true)
    setFailure(undefined)
    try {
      const outcome = outcomeOf<T>(
        await clientRef.current.post(path, { ...page, ...body }, ANSWER_REFUSALS)
      )
      if (outcome.ok) return outcome.data
      setFailure(outcome.detail ?? t('template.tab.failed'))
    } catch {
      setFailure(t('template.tab.failed'))
    } finally {
      setIsBusy(false)
    }
    return undefined
  }

  const changed = () => {
    offered.reload()
    props.onChanged()
  }

  async function apply() {
    if (await send('/micelio/templates/apply', {})) changed()
  }

  async function detach() {
    if (await send('/micelio/templates/detach', {})) {
      setSwitching({ kind: 'idle' })
      changed()
    }
  }

  async function look(to: TemplateSummary) {
    const planned = await send<{ plan: TemplateSwitchPlan }>('/micelio/templates/switch', {
      to: to.id,
      dryRun: true,
    })
    if (planned) setSwitching({ kind: 'planned', to, plan: planned.plan })
  }

  async function switchNow(to: TemplateSummary) {
    if (await send('/micelio/templates/switch', { to: to.id, dryRun: false })) {
      setSwitching({ kind: 'idle' })
      changed()
    }
  }

  const names = (ids: string[]) => ids.map(blockName).join(', ')
  const others = (choices.resource.kind === 'ready' ? choices.resource.data : []).filter(
    ({ id }) => id !== template?.id
  )

  return (
    <>
      {template ? (
        <Card>
          <Thumb aria-hidden="true">
            <TemplateThumbnail shapes={template.thumbnail} />
          </Thumb>
          <div>
            <Typography fontWeight="bold" tag="p">
              {template.name}{' '}
              <Typography textColor="neutral600" tag="span">
                · v{offer.version}
              </Typography>
            </Typography>
            <Typography variant="pi" textColor="neutral600" tag="p">
              {isBehind
                ? t('template.tab.since.behind', {
                    date: offer.startedAt
                      ? formatDate(offer.startedAt, { dateStyle: 'medium' })
                      : '',
                    version: template.version,
                  })
                : t('template.tab.since.current', {
                    date: offer.startedAt
                      ? formatDate(offer.startedAt, { dateStyle: 'medium' })
                      : '',
                  })}
            </Typography>
          </div>
        </Card>
      ) : null}

      {template && isBehind ? (
        <section aria-labelledby="template-changed" style={{ display: 'grid', gap: 8 }}>
          <Typography id="template-changed" fontWeight="bold" tag="h3">
            {t('template.tab.changed', { version: template.version })}
          </Typography>
          {offer.changes.length === 0 ? (
            <Typography variant="pi" textColor="neutral600" tag="p">
              {t('template.tab.changed.none')}
            </Typography>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, listStyle: 'disc' }}>
              {offer.changes.map((change, index) => (
                <li key={index}>{changeLine(t, change, blockName)}</li>
              ))}
            </ul>
          )}
          {isKept ? (
            <Typography variant="pi" textColor="neutral600" role="status" tag="p">
              {t('template.tab.kept', { version: offer.version ?? 0 })}
            </Typography>
          ) : (
            <Line style={{ justifyContent: 'flex-start' }}>
              <Button
                type="button"
                variant="secondary"
                disabled={isLocked}
                onClick={() => void apply()}
              >
                {t('template.tab.apply')}
              </Button>
              <Button type="button" variant="tertiary" onClick={() => setIsKept(true)}>
                {t('template.tab.keep', { version: offer.version ?? 0 })}
              </Button>
            </Line>
          )}
          <Typography variant="pi" textColor="neutral600" tag="p">
            {t('template.tab.apply.help')}
          </Typography>
        </section>
      ) : null}

      {offer.fixed.length > 0 ? (
        <Section aria-labelledby="template-fixed">
          <Typography id="template-fixed" fontWeight="bold" tag="h3">
            {t('template.tab.fixed')}
          </Typography>
          {offer.fixed.map((mark) => (
            <Line key={`${mark.block}#${mark.nth}`}>
              <Typography tag="span">{blockName(mark.block)}</Typography>
              <Tag>{t('template.tab.fixed.tag')}</Tag>
            </Line>
          ))}
          <Typography variant="pi" textColor="neutral600" tag="p">
            {t('template.tab.fixed.help')}
          </Typography>
        </Section>
      ) : null}

      <Section aria-labelledby="template-actions">
        <Typography id="template-actions" fontWeight="bold" tag="h3">
          {t('template.tab.actions')}
        </Typography>
        {switching.kind === 'idle' ? (
          <Action
            type="button"
            disabled={isLocked || props.isReadOnly}
            onClick={() => setSwitching({ kind: 'choosing' })}
          >
            <strong>{t('template.tab.switch')}</strong>{' '}
            <span style={{ color: colors.neutral600 }}>{t('template.tab.switch.help')}</span>
          </Action>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            <label id="template-switch" htmlFor="template-switch-to">
              <Typography variant="pi" fontWeight="bold" tag="span">
                {t('template.tab.switch.to')}
              </Typography>
            </label>
            <Select
              id="template-switch-to"
              value={switching.kind === 'planned' ? switching.to.id : ''}
              disabled={isBusy}
              onChange={(event) => {
                const to = others.find(({ id }) => id === event.target.value)
                if (to) void look(to)
                else setSwitching({ kind: 'choosing' })
              }}
            >
              <option value="">{t('template.tab.switch.choose')}</option>
              {others.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.name}
                </option>
              ))}
            </Select>
            {switching.kind === 'planned' ? (
              <div role="status" style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                <span>
                  {t('template.tab.switch.keeps', {
                    count: switching.plan.keeps.length,
                    blocks: names(switching.plan.keeps),
                  })}
                </span>
                {switching.plan.adds.length > 0 ? (
                  <span>
                    {t('template.tab.switch.adds', { blocks: names(switching.plan.adds) })}
                  </span>
                ) : null}
                <span
                  style={{ color: switching.plan.drops.length > 0 ? colors.danger700 : undefined }}
                >
                  {switching.plan.drops.length > 0
                    ? t('template.tab.switch.drops', {
                        blocks: names(switching.plan.drops.map(({ block }) => block)),
                      })
                    : t('template.tab.switch.dropsNone')}
                </span>
              </div>
            ) : null}
            <Line style={{ justifyContent: 'flex-start' }}>
              {switching.kind === 'planned' ? (
                <Button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void switchNow(switching.to)}
                >
                  {t('template.tab.switch.confirm', { name: switching.to.name })}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="tertiary"
                onClick={() => setSwitching({ kind: 'idle' })}
              >
                {t('template.tab.switch.cancel')}
              </Button>
            </Line>
          </div>
        )}
        {props.canManage && offer.isLinked ? (
          <Action type="button" disabled={isLocked} onClick={() => void detach()}>
            <strong>{t('template.tab.detach')}</strong>{' '}
            <span style={{ color: colors.neutral600 }}>{t('template.tab.detach.help')}</span>
          </Action>
        ) : null}
        {props.canManage ? (
          <Action type="button" disabled={props.isDirty} onClick={props.onSaveAsTemplate}>
            <strong>{t('template.tab.saveNew')}</strong>{' '}
            <span style={{ color: colors.neutral600 }}>{t('template.tab.manageOnly')}</span>
          </Action>
        ) : null}
        {props.isDirty ? (
          <Typography variant="pi" textColor="neutral600" tag="p">
            {t('builder.settings.saveTemplate.unsaved')}
          </Typography>
        ) : null}
        {failure ? (
          <Typography role="alert" variant="pi" textColor="danger700" tag="p">
            {failure}
          </Typography>
        ) : null}
      </Section>
      {!template ? (
        <Card style={{ background: colors.neutral100 }}>
          <Typography variant="pi" textColor="neutral700" tag="p">
            {offer.isLinked ? t('template.tab.gone') : t('template.tab.none')}
          </Typography>
        </Card>
      ) : null}
    </>
  )
}
