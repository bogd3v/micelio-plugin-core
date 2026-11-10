import { actionsFor, type EditorialState, type ReviewAction } from './review'

/** A step of the workflow the panel draws; the third is `scheduled` while the entry is scheduled. */
export type Step = 'draft' | 'in_review' | 'scheduled' | 'published'

/** The steps the panel draws for a state, and how far the entry has come. */
export function stepsFor(state: EditorialState): {
  steps: Step[]
  /** The index of the current step. */
  current: number
} {
  if (state === 'scheduled') return { steps: ['draft', 'in_review', 'scheduled'], current: 2 }
  const steps: Step[] = ['draft', 'in_review', 'published']
  return { steps, current: steps.indexOf(state as Step) }
}

/** The actions of a state with the primary one first, as the panel lists them. */
export function panelActions(state: EditorialState): ReviewAction[] {
  return [...actionsFor(state)].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
}
