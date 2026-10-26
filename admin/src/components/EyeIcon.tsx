import type { SVGProps } from 'react'

/**
 * The icon of the preview action: an eye.
 *
 * @remarks
 * Drawn here for the reason `MicelioIcon` is: `@strapi/icons` cannot be required in Node.
 */
export const EyeIcon = (props: SVGProps<SVGSVGElement>) => (
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
    <path style={{ fill: 'none' }} d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
