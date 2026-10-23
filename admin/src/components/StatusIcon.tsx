import type { SVGProps } from 'react'

/**
 * The menu icon of the status page: a screen with a check.
 *
 * @remarks
 * Drawn here instead of imported from `@strapi/icons`: that package's CommonJS build is a `.js`
 * file in a `"type": "module"` package, so `require('./strapi-admin')` fails in Node
 * (`test/package.test.ts`). Filled paths, as the admin's menu recolours `svg path` by `fill`.
 */
export const StatusIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1.6rem"
    height="1.6rem"
    viewBox="0 0 32 32"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path
      fillRule="evenodd"
      d="M4 5h24a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm1 3v13h22V8H5Z"
    />
    <path d="M11 26h10a1.5 1.5 0 0 1 0 3H11a1.5 1.5 0 0 1 0-3Z" />
    <path d="m9.5 14.5 2-2 3 3 6-6 2 2-8 8Z" />
  </svg>
)
