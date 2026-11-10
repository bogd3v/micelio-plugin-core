import { describe, expect, it } from 'vitest'
import { panelActions, stepsFor } from '../admin/src/utils/editorialPanel'

describe('the steps of the editorial panel', () => {
  it('draws Draft, In review and Published, with the current one by state', () => {
    expect(stepsFor('draft')).toEqual({ steps: ['draft', 'in_review', 'published'], current: 0 })
    expect(stepsFor('in_review')).toEqual({
      steps: ['draft', 'in_review', 'published'],
      current: 1,
    })
    expect(stepsFor('published')).toEqual({
      steps: ['draft', 'in_review', 'published'],
      current: 2,
    })
  })

  it('draws Scheduled in place of Published while the entry is scheduled', () => {
    expect(stepsFor('scheduled')).toEqual({
      steps: ['draft', 'in_review', 'scheduled'],
      current: 2,
    })
  })
})

describe('the buttons of the editorial panel', () => {
  it('lists the primary one first and keeps the builder’s moves', () => {
    const moves = (state: Parameters<typeof panelActions>[0]) =>
      panelActions(state).map(({ id }) => id)
    expect(moves('draft')).toEqual(['sendToReview', 'schedule'])
    expect(moves('in_review')).toEqual(['publish', 'sendBack'])
    expect(moves('scheduled')).toEqual(['unschedule'])
    expect(moves('published')).toEqual(['republish', 'unpublish'])
  })
})
