import { useFetchClient, useNotification } from '@strapi/strapi/admin'
import { useCallback, useRef } from 'react'
import { useIntl } from 'react-intl'
import { useHref } from 'react-router-dom'

import { useMessages } from '../messages'
import { ANSWER_REFUSALS } from '../utils/fetchError'
import {
  builderPath,
  transitionNotice,
  warningsOf,
  withCode,
  type EditorialState,
} from '../utils/review'

/** The page a transition moves. */
export interface TransitionPage {
  uid: string
  documentId: string
  /** `null` for a type that is not localised. */
  locale: string | null
}

/** What a transition asked of the server came to. */
export type TransitionOutcome = { ok: true; warnings: unknown[] } | { ok: false; problem: unknown }

/** What the request carries besides the page and the state. */
export interface TransitionOptions {
  publishAt?: string
  note?: string
  /** Only the checks: nothing is written, and the warnings are answered, not shown. */
  dryRun?: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * Returns the functions that ask `POST /micelio/transitions` to move a page and tell the editor
 * what the server answered (issue #57).
 *
 * @remarks
 * The server decides every transition (ADR-0017, section 5). `perform` shows each refusal, and each
 * warning of a transition that went through, as a notification of the admin with a link to the
 * block it names; a dry run shows nothing and hands the warnings back. `notify` shows one problem
 * detail the same way.
 */
export function useTransition(page: TransitionPage | undefined): {
  perform: (to: EditorialState, options?: TransitionOptions) => Promise<TransitionOutcome>
  notify: (problem: unknown, on?: TransitionPage) => void
} {
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const { toggleNotification } = useNotification()
  const { t } = useMessages()
  const { locale } = useIntl()
  // The admin is served under a path of its own (`/admin`): the link needs it.
  const root = useHref('/').replace(/\/+$/, '')

  const notify = useCallback(
    (problem: unknown, on: TransitionPage | undefined = page) => {
      const notice = transitionNotice(problem, locale, on)
      const link =
        notice.target && on
          ? { label: t('review.goToBlock'), url: `${root}${builderPath(on, notice.target)}` }
          : notice.previewPath
            ? { label: t('refusal.link'), url: `${root}${notice.previewPath}` }
            : undefined
      toggleNotification({
        type: notice.type,
        title: t(notice.title, notice.values),
        message: withCode(t(notice.message, notice.values), notice.code),
        link,
        timeout: 15_000,
      })
    },
    [page, locale, toggleNotification, t, root]
  )

  const perform = useCallback(
    async (to: EditorialState, options: TransitionOptions = {}): Promise<TransitionOutcome> => {
      if (!page) return { ok: false, problem: undefined }
      let body: unknown
      try {
        // The client drops the body of a refusal it does not know: the route is asked to answer it.
        const answer = await clientRef.current.post(
          '/micelio/transitions',
          {
            uid: page.uid,
            documentId: page.documentId,
            locale: page.locale ?? undefined,
            to,
            ...options,
          },
          ANSWER_REFUSALS
        )
        body = answer.data
      } catch (error) {
        body = { code: 'failed', detail: error instanceof Error ? error.message : '' }
      }
      const status = isRecord(body) ? body.status : undefined
      if (
        !isRecord(body) ||
        !isRecord(body.data) ||
        (typeof status === 'number' && status >= 400)
      ) {
        if (!options.dryRun) notify(body)
        return { ok: false, problem: body }
      }
      const warnings = warningsOf(body)
      if (!options.dryRun) for (const warning of warnings) notify(warning)
      return { ok: true, warnings }
    },
    [page, notify]
  )

  return { perform, notify }
}
