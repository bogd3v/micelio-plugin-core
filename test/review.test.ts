import { describe, expect, it } from 'vitest'
import en from '../admin/src/translations/en.json'
import es from '../admin/src/translations/es.json'
import {
  actionsFor,
  builderPath,
  instantOf,
  toLocalInput,
  transitionNotice,
  warningsOf,
  withCode,
} from '../admin/src/utils/review'

const PAGE = { uid: 'api::page.page', documentId: 'doc1', locale: 'en' }

describe('the buttons of each editorial state', () => {
  it('offers the moves a person makes, never the scheduler’s own', () => {
    const moves = (state: Parameters<typeof actionsFor>[0]) =>
      actionsFor(state).map(({ id, to }) => `${id}->${to}`)
    expect(moves('draft')).toEqual(['schedule->scheduled', 'sendToReview->in_review'])
    expect(moves('in_review')).toEqual(['sendBack->draft', 'publish->published'])
    expect(moves('scheduled')).toEqual(['unschedule->draft'])
    expect(moves('published')).toEqual(['unpublish->draft', 'republish->published'])
  })
})

describe('transitionNotice', () => {
  it('lists the problems of seoInvalid by code, and shows descriptionRepeatsTitle as a warning', () => {
    const refused = transitionNotice(
      {
        code: 'seoInvalid',
        problems: [{ code: 'metaDescriptionTooLong' }, { code: 'metaImageMissing' }, 'x'],
      },
      'en',
      PAGE
    )
    expect(refused).toMatchObject({
      type: 'danger',
      code: 'seoInvalid',
      title: 'review.refusal.seoInvalid.title',
      message: 'review.refusal.seoInvalid',
      values: { problems: 'metaDescriptionTooLong,metaImageMissing' },
    })
    const warning = transitionNotice({ code: 'descriptionRepeatsTitle' }, 'en')
    expect(warning).toMatchObject({
      type: 'warning',
      message: 'review.refusal.descriptionRepeatsTitle',
    })
    for (const messages of [en, es] as Record<string, string>[]) {
      for (const code of ['seoInvalid', 'descriptionRepeatsTitle']) {
        expect(messages[`review.refusal.${code}`]).toContain(code)
        expect(messages[`review.refusal.${code}.title`]).toBeTruthy()
      }
    }
  })

  it('points at the block a refusal names, from 0 whichever way the code counts', () => {
    const island = transitionNotice(
      {
        code: 'islandAlternativeMissing',
        detail: 'The static alternative of the scene block at position 2 (poster) is not filled in',
        blocks: [{ block: 'scene', position: 1, fields: ['poster', 'alt'], zone: 'sections' }],
      },
      'en'
    )
    expect(island).toMatchObject({
      type: 'danger',
      title: 'review.refusal.islandAlternativeMissing.title',
      message: 'review.refusal.islandAlternativeMissing',
      values: { block: 'scene', position: 2, fields: 'poster, alt' },
      target: { block: 'scene', position: 1 },
    })
    // The budget counts its places from 1, and its blocks carry `id`.
    const over = transitionNotice(
      {
        code: 'pageOverBudget',
        budgetKb: 60,
        blocksKb: 146,
        overByKb: 86,
        blocks: [{ position: 2, id: 'scene', kb: 142 }],
      },
      'en',
      PAGE
    )
    expect(over).toMatchObject({
      title: 'review.refusal.pageOverBudget.title',
      message: 'refusal.pageOverBudget',
      target: { block: 'scene', position: 1 },
    })
    expect(over.previewPath).toBeUndefined()
  })

  it('links a refusal that names no block to the preview page, and shows an unknown code’s detail', () => {
    const unavailable = transitionNotice(
      { code: 'previewUnavailable', detail: 'The site has no url' },
      'en',
      PAGE
    )
    expect(unavailable).toMatchObject({ message: 'refusal.previewUnavailable', target: undefined })
    expect(unavailable.previewPath).toBe(
      '/plugins/micelio/preview/api%3A%3Apage.page/doc1?locale=en'
    )
    expect(transitionNotice({ code: 'somethingNew', detail: 'Why' }, 'en')).toEqual({
      type: 'danger',
      code: 'somethingNew',
      title: 'review.refusal.title',
      message: 'review.refusal.other',
      values: { detail: 'Why' },
    })
    expect(transitionNotice(undefined, 'en').code).toBe('failed')
  })

  it('reads the linkToDraft warning, with each page once', () => {
    const link = (title: string, position: number) => ({
      block: 'cta',
      position,
      field: 'primaryLink',
      path: `/${title.toLowerCase()}`,
      zone: 'sections',
      page: { uid: 'api::page.page', documentId: title, title },
    })
    const notice = transitionNotice(
      { code: 'linkToDraft', blocks: [link('Pricing', 0), link('Pricing', 2), link('Team', 3)] },
      'en'
    )
    expect(notice).toMatchObject({
      type: 'warning',
      values: { count: 3, pages: 'Pricing, Team' },
      target: { block: 'cta', position: 0 },
    })
  })

  it('has a message in both languages for every code it names', () => {
    const codes = [
      'pageOverBudget',
      'previewUnavailable',
      'editorialTransitionForbidden',
      'editorialPublishAtInvalid',
      'islandAlternativeMissing',
      'sampleTextPresent',
      'linkToDraft',
    ]
    for (const code of codes) {
      const { title, message } = transitionNotice({ code, blocks: [] }, 'en', PAGE)
      for (const messages of [en, es] as Record<string, string>[]) {
        expect(messages[title], title).toBeTypeOf('string')
        expect(messages[message], message).toBeTypeOf('string')
      }
    }
    for (const state of ['draft', 'in_review', 'scheduled', 'published'] as const) {
      for (const { id } of actionsFor(state)) {
        expect((es as Record<string, string>)[`review.action.${id}`]).toBeTypeOf('string')
      }
    }
  })
})

describe('withCode', () => {
  it('ends a notice with its code once, and a failed request with none', () => {
    expect(withCode('Its blocks weigh 146 kB.', 'pageOverBudget')).toBe(
      'Its blocks weigh 146 kB. · pageOverBudget'
    )
    expect(
      withCode('Refused. · editorialTransitionForbidden', 'editorialTransitionForbidden')
    ).toBe('Refused. · editorialTransitionForbidden')
    expect(withCode('The network failed', 'failed')).toBe('The network failed')
  })
})

describe('the helpers of the dialogs', () => {
  it('reads the warnings of an answer', () => {
    expect(warningsOf({ data: { warnings: [{ code: 'linkToDraft' }] } })).toEqual([
      { code: 'linkToDraft' },
    ])
    expect(warningsOf({ data: {} })).toEqual([])
    expect(warningsOf(null)).toEqual([])
  })

  it('opens the builder at the block a refusal names', () => {
    expect(builderPath(PAGE, { block: 'scene', position: 1 })).toBe(
      '/plugins/micelio/builder/api::page.page/doc1?locale=en&block=scene&position=1'
    )
    expect(builderPath({ ...PAGE, locale: null })).toBe(
      '/plugins/micelio/builder/api::page.page/doc1'
    )
  })

  it('turns the date and time of the schedule into an instant, and back', () => {
    const at = new Date(2026, 10, 3, 8, 5)
    expect(toLocalInput(at)).toBe('2026-11-03T08:05')
    expect(instantOf('2026-11-03', '08:05')).toBe(at.toISOString())
    expect(instantOf('2026-11-03', '')).toBeUndefined()
    expect(instantOf('3/11/2026', '08:05')).toBeUndefined()
    expect(instantOf('2026-13-45', '08:05')).toBeUndefined()
  })
})
