import { PREVIEW_PROTOCOL_VERSION } from '../../../contract/preview'

/** The widths of the preview, as the design's toolbar offers them (phone, tablet and desktop). */
export const DEVICES = [
  { id: 'phone', width: 320 },
  { id: 'tablet', width: 768 },
  { id: 'desktop', width: 1280 },
] as const

/** A device of the toolbar. */
export type DeviceId = (typeof DEVICES)[number]['id']

/** What the toolbar shows: the draft with its islands, or with each island on its static alternative. */
export type PreviewMode = 'live' | 'static'

/** An action a shortcut of the Shortcuts sheet (Preview and Page groups) runs. */
export type PreviewShortcut = { action: 'device'; device: DeviceId } | { action: 'static' | 'back' }

/** The minutes the page waits after it asked for a token before it asks for a new one: the grant lasts 15 minutes. */
export const GRANT_REFRESH_MINUTES = 14

/**
 * The seconds the pane waits for `ready` after the frame has loaded before it says the preview did not
 * start (ADR-0019, amendment of 2026-10-26). Long enough for a slow frontend that works.
 */
export const READY_WAIT_SECONDS = 10

/** How often the page reads the document to notice a save made elsewhere, in milliseconds. */
export const SAVE_POLL_MS = 4000

/** The envelope versions the admin speaks: its own release's (ADR-0019, section 4). */
export const SPOKEN_VERSIONS: readonly number[] = [PREVIEW_PROTOCOL_VERSION]

/** The keys of a keyboard event the shortcuts read. */
export interface ShortcutEvent {
  code: string
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  target: unknown
}

/**
 * The URL the iframe loads: the one the token route answered, asking for the static alternatives in
 * static mode.
 *
 * @returns The URL, and the origin of the site, the only origin the page talks to; `undefined` when `url`
 * is not an `http` or `https` URL.
 */
export function frameTarget(
  url: string,
  mode: PreviewMode
): { src: string; origin: string } | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Not a URL: the site's `url` is configuration, and the page says the preview is unavailable.
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  if (mode === 'static') parsed.searchParams.set('mode', 'static')
  return { src: parsed.toString(), origin: parsed.origin }
}

/** The part of a window the pane uses to send it to the preview: what `window.open` answers. */
export interface PreviewTab {
  /** The window that opened this one; cleared so a site without `Cross-Origin-Opener-Policy` cannot reach the admin. */
  opener: unknown
  location: { href: string }
  close: () => void
}

/**
 * Opens the preview in a window of its own, in a way a popup blocker lets through: the window is opened
 * at once, in the click, and sent to the URL once `askForUrl` answers (ADR-0019, amendment of 2026-10-26).
 *
 * @remarks
 * The window is opened without `noopener`, or the browser would hide it from the click, so `opener` is
 * cleared right after. The site's `Cross-Origin-Opener-Policy` is a second barrier, and no message is
 * sent to the window. The URL holds
 * the single-use token and goes nowhere else.
 *
 * @param openWindow - Opens a blank window; `null` when the browser refused.
 * @param askForUrl - Asks the token route for the URL the window loads.
 * @returns `false` when the browser refused the window and nothing was asked.
 * @throws What `askForUrl` threw, after closing the blank window.
 */
export async function openInNewTab(
  openWindow: () => PreviewTab | null,
  askForUrl: () => Promise<string>
): Promise<boolean> {
  const tab = openWindow()
  if (!tab) return false
  tab.opener = null
  try {
    tab.location.href = await askForUrl()
  } catch (error) {
    tab.close()
    throw error
  }
  return true
}

// Inputs that take no text: a shortcut pressed on one of them is not typing.
const NON_TEXT_INPUTS = [
  'button',
  'checkbox',
  'radio',
  'submit',
  'reset',
  'image',
  'range',
  'color',
]

/** Whether a shortcut would land in a field the editor types in or chooses from with the keys. */
export function isTypingTarget(target: unknown): boolean {
  const element = target as {
    tagName?: unknown
    isContentEditable?: unknown
    type?: unknown
  } | null
  if (!element || typeof element.tagName !== 'string') return false
  const tag = element.tagName.toUpperCase()
  if (tag === 'INPUT')
    return !NON_TEXT_INPUTS.includes(String(element.type ?? 'text').toLowerCase())
  return element.isContentEditable === true || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * The preview shortcut a key press is, from the Shortcuts sheet: ⌘⇧1, ⌘⇧2 and ⌘⇧3 for the widths,
 * ⌘⇧S for "as static site" and ⌘⇧← back to the entry (⌘ is Ctrl on Windows and Linux).
 *
 * @remarks
 * Never inside a field. A press with Alt, or with ⌘ and Ctrl together, is not one.
 */
export function previewShortcut(event: ShortcutEvent): PreviewShortcut | undefined {
  if (isTypingTarget(event.target)) return undefined
  if (event.ctrlKey === event.metaKey || !event.shiftKey || event.altKey) return undefined
  const device = DEVICES[['Digit1', 'Digit2', 'Digit3'].indexOf(event.code)]
  if (device) return { action: 'device', device: device.id }
  if (event.code === 'KeyS') return { action: 'static' }
  if (event.key === 'ArrowLeft') return { action: 'back' }
  return undefined
}
