import type { ReactNode } from 'react'

import type { IslandKind } from '../../../../contract/islands'

/** A 16 px line icon, drawn in the current colour and hidden from assistive technology. */
function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const ChevronLeftIcon = () => (
  <Icon>
    <path d="M10 3 5 8l5 5" />
  </Icon>
)
export const ChevronRightIcon = () => (
  <Icon>
    <path d="m6 3 5 5-5 5" />
  </Icon>
)
export const UpIcon = () => (
  <Icon>
    <path d="m3 10 5-5 5 5" />
  </Icon>
)
export const DownIcon = () => (
  <Icon>
    <path d="m3 6 5 5 5-5" />
  </Icon>
)
export const DuplicateIcon = () => (
  <Icon>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 3.5v-1h-8v8h1" />
  </Icon>
)
export const TrashIcon = () => (
  <Icon>
    <path d="M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.6 9h5.8l.6-9" />
  </Icon>
)
export const PhoneIcon = () => (
  <Icon>
    <rect x="4.5" y="1.5" width="7" height="13" rx="1.5" />
    <path d="M7 12.5h2" />
  </Icon>
)
export const TabletIcon = () => (
  <Icon>
    <rect x="2.5" y="1.5" width="11" height="13" rx="1.5" />
    <path d="M7 12.5h2" />
  </Icon>
)
export const DesktopIcon = () => (
  <Icon>
    <rect x="1.5" y="2.5" width="13" height="8.5" rx="1.5" />
    <path d="M5.5 14h5M8 11v3" />
  </Icon>
)
export const ClockIcon = () => (
  <Icon size={12}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.5 1.5" />
  </Icon>
)
export const GripIcon = () => (
  <Icon>
    <path d="M6 3.5v.01M10 3.5v.01M6 8v.01M10 8v.01M6 12.5v.01M10 12.5v.01" strokeWidth="2.4" />
  </Icon>
)
export const BlockGlyph = ({ isIsland }: { isIsland: boolean }) => (
  <Icon>
    {isIsland ? <path d="M3 12 8 3l5 9z" /> : <rect x="3" y="3" width="10" height="10" rx="2" />}
  </Icon>
)

/** The icon of a kind of island (the Island badge artboard): one line drawing each. */
export const KindIcon = ({ kind, size = 16 }: { kind: IslandKind; size?: number }) => (
  <Icon size={size}>
    {kind === '3d' ? (
      <path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5zM2.5 5 8 8.2 13.5 5M8 8.2v6" />
    ) : kind === 'runtime' ? (
      <path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
    ) : kind === 'media' ? (
      <>
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <circle cx="5.8" cy="6.5" r="1" />
        <path d="m2.5 12 3.5-3 2.5 2 2-1.5 3 2.5" />
      </>
    ) : kind === 'diagram' ? (
      <>
        <rect x="2" y="2.5" width="4.5" height="3.5" rx="1" />
        <rect x="9.5" y="10" width="4.5" height="3.5" rx="1" />
        <path d="M4.2 6v3.8h5.3M7.5 9.8" />
      </>
    ) : (
      <path d="M3 13V8M6.5 13V4M10 13V9.5M13.5 13V6" />
    )}
  </Icon>
)
export const ViewIcon = () => (
  <Icon size={12}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
)
export const GearIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3" />
  </Icon>
)
export const CloseIcon = () => (
  <Icon>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
)
