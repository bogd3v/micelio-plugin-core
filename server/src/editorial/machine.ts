import type { EditorialState } from '../constants/editorial'

/** A move from one editorial state to another. */
export interface Transition {
  from: EditorialState
  to: EditorialState
}

/**
 * Roles that may perform each transition, by Strapi admin role code, keyed `from->to`.
 *
 * @remarks
 * A site stores its own in `editorialPolicy`; a transition it does not list keeps the default.
 */
export type EditorialPolicy = Partial<Record<string, string[]>>

/** Who asks for a transition: an admin user with their role codes, or the plugin itself. */
export type Actor = { kind: 'user'; id: number; roles: string[] } | { kind: 'system' }

// ADR-0017, section 5 and its 2026-10-25 amendment (`published -> published`, republish).
// `scheduled -> published` belongs to the scheduler alone.
const TRANSITIONS: readonly Transition[] = [
  { from: 'draft', to: 'in_review' },
  { from: 'in_review', to: 'draft' },
  { from: 'in_review', to: 'published' },
  { from: 'draft', to: 'scheduled' },
  { from: 'scheduled', to: 'draft' },
  { from: 'scheduled', to: 'published' },
  { from: 'published', to: 'draft' },
  { from: 'published', to: 'published' },
]

const SYSTEM_TRANSITIONS = new Set(['scheduled->published'])

const SUPER_ADMIN = 'strapi-super-admin'
const EDITOR = 'strapi-editor'
const AUTHOR = 'strapi-author'

/**
 * Who may perform each user transition when the site sets nothing: the roles Strapi creates.
 *
 * @remarks
 * Changing a default is a breaking change of the editorial contract (section 6 of the standard).
 */
export const DEFAULT_EDITORIAL_POLICY: Readonly<Record<string, readonly string[]>> = {
  'draft->in_review': [AUTHOR, EDITOR, SUPER_ADMIN],
  'in_review->draft': [AUTHOR, EDITOR, SUPER_ADMIN],
  'in_review->published': [EDITOR, SUPER_ADMIN],
  'draft->scheduled': [EDITOR, SUPER_ADMIN],
  'scheduled->draft': [EDITOR, SUPER_ADMIN],
  'published->draft': [EDITOR, SUPER_ADMIN],
  'published->published': [EDITOR, SUPER_ADMIN],
}

/** The key of a transition in a policy: `from->to`. */
export function transitionKey({ from, to }: Transition): string {
  return `${from}->${to}`
}

/** Whether the state machine has this transition at all, whoever asks. */
export function isTransition(transition: Transition): boolean {
  return TRANSITIONS.some(({ from, to }) => from === transition.from && to === transition.to)
}

/**
 * Whether an actor may perform a transition under a site's policy.
 *
 * @remarks
 * The plugin itself performs only `scheduled -> published`, and no user does. A user may perform
 * a transition when one of their roles is listed for it in the site's policy, or in
 * {@link DEFAULT_EDITORIAL_POLICY} when the site lists nothing for it. Whether the transition
 * exists is {@link isTransition}'s question, not this one's.
 */
export function mayPerform(
  actor: Actor,
  transition: Transition,
  policy: EditorialPolicy | null | undefined
): boolean {
  const key = transitionKey(transition)
  if (SYSTEM_TRANSITIONS.has(key)) return actor.kind === 'system'
  if (actor.kind === 'system') return false
  const roles = policy?.[key] ?? DEFAULT_EDITORIAL_POLICY[key] ?? []
  return actor.roles.some((role) => roles.includes(role))
}

/**
 * A site's `editorialPolicy` checked for shape, or the reason it is invalid.
 *
 * @param value - The field as stored: `null` and `undefined` mean the default policy.
 */
export function parseEditorialPolicy(
  value: unknown
): { policy: EditorialPolicy } | { error: string } {
  if (value === null || value === undefined) return { policy: {} }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'editorialPolicy must map transitions to lists of role codes' }
  }
  const policy: EditorialPolicy = {}
  for (const [key, roles] of Object.entries(value)) {
    if (!(key in DEFAULT_EDITORIAL_POLICY)) {
      return { error: `"${key}" is not a transition a user performs` }
    }
    if (!Array.isArray(roles) || !roles.every((role) => typeof role === 'string')) {
      return { error: `the roles of "${key}" must be a list of role codes` }
    }
    policy[key] = roles
  }
  return { policy }
}
