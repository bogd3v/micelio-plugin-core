// The names that must have a Spanish label (`labels/es.json`): the ones the core uses and the ones
// the picker suggests first (decision of the maintainer, 2026-11-12). Every other name answers its
// English label in Spanish. A name enters a group when the core starts to use it; a name that
// leaves the contract leaves the list, and `labels.test.ts` checks that each is a name of the set.

/** The core's defaults: what a block renders when the editor picks no icon. */
export const DEFAULT_NAMES = [
  // `callout`: one per `kind`
  'info-circle',
  'bulb',
  'alert-triangle',
  'alert-octagon',
  // `plan.features`: the `included` marker
  'check',
  'x',
] as const

/** The names suggested first for the four fields that take an icon in step 1. */
export const SUGGESTED_NAMES = {
  'feature-item': [
    'rocket',
    'shield-check',
    'bolt',
    'heart',
    'world',
    'lock',
    'puzzle',
    'device-desktop',
    'leaf',
    'star',
    'message-circle',
    'calendar',
  ],
  link: ['arrow-right', 'arrow-up-right', 'external-link', 'download', 'link', 'mail', 'phone'],
  stat: ['chart-bar', 'trending-up', 'users', 'clock', 'map-pin'],
  'plan.features': ['check', 'circle-check', 'circle-x', 'x'],
} as const

/** Every name that needs a Spanish label, each once. */
export const CORE_NAMES: readonly string[] = [
  ...new Set([...DEFAULT_NAMES, ...Object.values(SUGGESTED_NAMES).flat()]),
]
