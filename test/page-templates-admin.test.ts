import { describe, expect, it } from 'vitest'
import { ANSWER_REFUSALS, outcomeOf } from '../admin/src/utils/fetchError'
import { galleryPagePath, hasTemplates } from '../admin/src/utils/templateAction'
import { blockNamesLine, optionsLine, templateFileName } from '../admin/src/utils/templates'
import en from '../admin/src/translations/en.json'
import es from '../admin/src/translations/es.json'

describe('the answer of a route that refuses with a problem detail', () => {
  it('lets a 401 throw, so that the client refreshes an expired token, and answers the other refusals', () => {
    expect(ANSWER_REFUSALS.validateStatus(401)).toBe(false)
    for (const status of [200, 403, 404, 409, 422, 502]) {
      expect(ANSWER_REFUSALS.validateStatus(status)).toBe(true)
    }
  })

  it('is the data of a good answer', () => {
    expect(outcomeOf<{ id: string }>({ data: { data: { id: 'a' } } })).toEqual({
      ok: true,
      data: { id: 'a' },
    })
  })

  it('is the code and the detail of a refusal, which the client does not throw', () => {
    expect(
      outcomeOf({
        data: {
          type: 'about:blank',
          status: 409,
          code: 'templateNameTaken',
          detail: 'A template named "x" already exists on default',
        },
      })
    ).toEqual({
      ok: false,
      code: 'templateNameTaken',
      detail: 'A template named "x" already exists on default',
    })
  })

  it('is a refusal with no members for an answer that is neither', () => {
    expect(outcomeOf({ data: { error: { status: 401 } } })).toEqual({ ok: false })
    expect(outcomeOf({ data: 'Bad gateway' })).toEqual({ ok: false })
    expect(outcomeOf({ data: null })).toEqual({ ok: false })
  })
})

describe('the create view offers the gallery', () => {
  const page = {
    attributes: { sections: { type: 'dynamiczone' }, title: { type: 'string' } },
    pluginOptions: { micelio: { siteScoped: true, pageSettings: true } },
  }

  it('to a site-scoped page type with page settings and a zone of blocks', () => {
    expect(hasTemplates(page)).toBe(true)
  })

  it.each([
    ['no schema', undefined],
    ['a type with no page settings', { ...page, pluginOptions: { micelio: { siteScoped: true } } }],
    [
      'a type that belongs to no site',
      { ...page, pluginOptions: { micelio: { pageSettings: true } } },
    ],
    ['a type with no zone', { ...page, attributes: { title: { type: 'string' } } }],
  ])('not to %s', (_name, schema) => {
    expect(hasTemplates(schema)).toBe(false)
  })

  it('opens the gallery of the type, with its UID encoded', () => {
    expect(galleryPagePath('api::page.page')).toBe('/plugins/micelio/new/api%3A%3Apage.page')
  })
})

describe('how a template reads', () => {
  it('lists the options of a block, and the names of the blocks of a template', () => {
    expect(optionsLine({ variant: 'split', tone: 'default' })).toBe('variant split · tone default')
    expect(optionsLine({})).toBe('')
    const blocks = [
      { block: 'hero', options: {}, content: 'sample' as const, fixed: false },
      { block: 'feature-grid', options: {}, content: 'clear' as const, fixed: true },
    ]
    expect(blockNamesLine(blocks, (id) => id.toUpperCase())).toBe('HERO, FEATURE-GRID')
  })

  it('names the file of an exported template after it', () => {
    expect(templateFileName('Explainer landing')).toBe('explainer-landing.micelio-template.json')
    expect(templateFileName('***')).toBe('template.micelio-template.json')
  })

  it('has every string of the dialog and the gallery in English and in Spanish', () => {
    const keys = Object.keys(en).filter(
      (key) => key.startsWith('template.') || key.startsWith('builder.settings.saveTemplate')
    )
    expect(keys.length).toBeGreaterThan(40)
    for (const key of [...keys, 'action.newFromTemplate', 'builder.sample.hint']) {
      expect(es).toHaveProperty([key])
      expect((es as Record<string, string>)[key]).not.toBe((en as Record<string, string>)[key])
    }
  })
})
