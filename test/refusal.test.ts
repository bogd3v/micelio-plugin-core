import { describe, expect, it } from 'vitest'
import en from '../admin/src/translations/en.json'
import es from '../admin/src/translations/es.json'
import { refusalNotice, refusalNotification } from '../admin/src/utils/refusal'

const ENTRY = { uid: 'api::page.page', documentId: 'doc1', locale: 'es' }
const PREVIEW = '/plugins/micelio/preview/api%3A%3Apage.page/doc1?locale=es'

// A problem detail as `POST /micelio/transitions` answers it (docs/api.md).
const OVER = {
  type: 'about:blank',
  title: 'Conflict',
  status: 409,
  code: 'pageOverBudget',
  detail:
    'The blocks of the page weigh 170 kB and the budget of a standard page is 120 kB, 50 kB over',
  pageType: 'standard',
  budgetKb: 120,
  blocksKb: 170.04,
  frameworkKb: 20,
  totalKb: 190.04,
  overByKb: 50.04,
  blocks: [
    { position: 3, id: 'gallery', kb: 80 },
    { position: 1, id: 'hero', kb: 50.5 },
    { position: 2, id: 'quote', kb: 30 },
    { position: 4, id: 'rich-text', kb: 9.54 },
  ],
}

describe('the notification of a refused publish', () => {
  it('says how far over the budget a page is and names its heaviest blocks', () => {
    expect(refusalNotice(OVER, ENTRY)).toEqual({
      message: {
        id: 'refusal.pageOverBudget',
        values: {
          weight: '170',
          budget: '120',
          over: '50',
          blocks: 'gallery (80 kB), hero (50.5 kB), quote (30 kB)',
        },
      },
      previewPath: PREVIEW,
    })
  })

  it('gives the cause of a page that could not be measured, with the link to the preview', () => {
    const problem = {
      status: 409,
      code: 'previewUnavailable',
      detail: 'The site has no url, so there is no frontend to measure the page on',
    }
    expect(refusalNotice(problem, ENTRY)).toEqual({
      message: { id: 'refusal.previewUnavailable', values: { cause: problem.detail } },
      previewPath: PREVIEW,
    })
  })

  it('links the preview of a type that is not localised without a locale', () => {
    const notice = refusalNotice(OVER, { ...ENTRY, locale: null })
    expect(notice?.previewPath).toBe('/plugins/micelio/preview/api%3A%3Apage.page/doc1')
  })

  it('reads a list of blocks it cannot read as no blocks, and a missing detail as no cause', () => {
    expect(refusalNotice({ ...OVER, blocks: 'many' }, ENTRY)?.message.values.blocks).toBe('')
    expect(refusalNotice({ code: 'previewUnavailable' }, ENTRY)?.message.values.cause).toBe('')
  })

  it.each([
    ['another code', { status: 409, code: 'editorialTransitionInvalid' }],
    ['a pageOverBudget without its numbers', { code: 'pageOverBudget', blocks: [] }],
    ['text', 'Conflict'],
    ['nothing', null],
    ['a number', 409],
  ])('leaves %s to the control that made the request', (_name, problem) => {
    expect(refusalNotice(problem, ENTRY)).toBeUndefined()
  })

  it('has its texts in English and Spanish, and fills every value they take', () => {
    for (const [lang, messages] of [
      ['en', en],
      ['es', es],
    ] as const) {
      const table = messages as Record<string, string>
      for (const id of [
        'refusal.title',
        'refusal.link',
        'refusal.pageOverBudget',
        'refusal.previewUnavailable',
      ]) {
        expect(table[id], `${lang} ${id}`).toBeTruthy()
      }
      const used = (id: string) =>
        [...(table[id] ?? '').matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort()
      expect(used('refusal.pageOverBudget')).toEqual(['blocks', 'budget', 'over', 'weight'])
      expect(used('refusal.previewUnavailable')).toEqual(['cause'])
    }
  })
})

describe('refusalNotification', () => {
  const t = (id: string, values?: Record<string, string | number>) =>
    `${id}${values ? JSON.stringify(values) : ''}`

  it('is a danger notification whose link goes under the root of the admin', () => {
    const notification = refusalNotification(OVER, ENTRY, '/admin', t)
    expect(notification).toMatchObject({
      type: 'danger',
      title: 'refusal.title',
      link: { label: 'refusal.link', url: `/admin${PREVIEW}` },
      timeout: 15_000,
    })
    expect(notification?.message).toContain('refusal.pageOverBudget')
    expect(notification?.message).toContain('gallery (80 kB), hero (50.5 kB), quote (30 kB)')
  })

  it('links without a prefix when the admin is served at the top', () => {
    expect(refusalNotification(OVER, ENTRY, '', t)?.link.url).toBe(PREVIEW)
  })

  it('says the cause of an unavailable measurement', () => {
    const problem = { code: 'previewUnavailable', detail: 'The site has no url' }
    expect(refusalNotification(problem, ENTRY, '/admin', t)?.message).toBe(
      'refusal.previewUnavailable{"cause":"The site has no url"}'
    )
  })

  it('is undefined for a refusal that is not a budget one', () => {
    expect(refusalNotification({ code: 'forbidden' }, ENTRY, '/admin', t)).toBeUndefined()
  })
})
