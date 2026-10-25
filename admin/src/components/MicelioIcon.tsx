import type { SVGProps } from 'react'

/**
 * The menu icon of the Micelio entry: the small mark, a mycelium of branches ending in nodes.
 *
 * @remarks
 * Drawn here instead of imported from `@strapi/icons`: that package's CommonJS build is a `.js`
 * file in a `"type": "module"` package, so `require('./strapi-admin')` fails in Node
 * (`test/package.test.ts`). The admin's menu recolours `svg path` with `fill`, which would turn
 * the stroked branches into filled shapes: the branch path sets `fill: none` inline, which
 * wins over that rule. Design: the mark of the page artboards of the plugin admin canvas.
 */
export const MicelioIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1.6rem"
    height="1.6rem"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path
      style={{ fill: 'none' }}
      d="M3.7 12.3c1.8-1.6 3.1-2.7 3.7-3.4M7.4 8.9c1.2-3 -.7-2.5 1.8-5.7M7.4 8.9c.7-.9 4.4-.7 5.9-1.7s1.7-3 7-2.5M20.3 4.7c-5.3 4-.4 5.6-6.6 8.8M3.7 12.3c7.3-.5 3.5 2 10 1.2M3.7 12.3c6.8 3.6.1 4.5 6.4 8.6M10.1 20.9c5.2-.8 3.5-6.2 10.9-4"
    />
    <circle cx="9.2" cy="3.2" r="1.9" fill="currentColor" stroke="none" />
    <circle cx="20.3" cy="4.7" r="1.9" fill="currentColor" stroke="none" />
    <circle cx="13.7" cy="13.5" r="1.9" fill="currentColor" stroke="none" />
    <circle cx="21" cy="16.9" r="1.9" fill="currentColor" stroke="none" />
    <circle cx="10.1" cy="20.9" r="1.9" fill="currentColor" stroke="none" />
    <circle cx="3.7" cy="12.3" r="2.6" fill="currentColor" stroke="none" />
  </svg>
)
