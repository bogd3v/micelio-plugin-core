import { describe, expect, it } from 'vitest'
import { PREVIEW_PROTOCOL_VERSION } from '../contract/preview'
import {
  DEVICES,
  SPOKEN_VERSIONS,
  frameTarget,
  isTypingTarget,
  previewShortcut,
  type ShortcutEvent,
} from '../admin/src/utils/previewPane'

const press = (init: Partial<ShortcutEvent>): ShortcutEvent => ({
  code: '',
  key: '',
  ctrlKey: true,
  metaKey: false,
  shiftKey: true,
  altKey: false,
  target: { tagName: 'BODY' },
  ...init,
})

describe('the URL of the preview frame', () => {
  it('keeps the URL the token route answered and names the site as the one origin', () => {
    expect(frameTarget('https://example.com/_preview?token=abc', 'live')).toEqual({
      src: 'https://example.com/_preview?token=abc',
      origin: 'https://example.com',
    })
  })

  it('asks for the static alternatives in static mode, keeping the token', () => {
    const target = frameTarget('https://example.com:8443/_preview?token=abc', 'static')
    expect(target?.origin).toBe('https://example.com:8443')
    expect(new URL(target?.src ?? '').searchParams.get('token')).toBe('abc')
    expect(new URL(target?.src ?? '').searchParams.get('mode')).toBe('static')
  })

  it('refuses what is not an http or https URL', () => {
    expect(frameTarget('not a url', 'live')).toBeUndefined()
    expect(frameTarget('javascript:alert(1)', 'live')).toBeUndefined()
    expect(frameTarget('data:text/html,hello', 'live')).toBeUndefined()
  })
})

describe('the shortcuts of the preview', () => {
  it('has a width shortcut for each device of the toolbar', () => {
    expect(DEVICES.map(({ width }) => width)).toEqual([320, 768, 1280])
    expect(['Digit1', 'Digit2', 'Digit3'].map((code) => previewShortcut(press({ code })))).toEqual([
      { action: 'device', device: 'phone' },
      { action: 'device', device: 'tablet' },
      { action: 'device', device: 'desktop' },
    ])
  })

  it('maps the static site and the way back, with Ctrl or Command', () => {
    expect(previewShortcut(press({ code: 'KeyS' }))).toEqual({ action: 'static' })
    expect(previewShortcut(press({ code: 'KeyS', ctrlKey: false, metaKey: true }))).toEqual({
      action: 'static',
    })
    expect(previewShortcut(press({ key: 'ArrowLeft', code: 'ArrowLeft' }))).toEqual({
      action: 'back',
    })
  })

  it('ignores a press without Shift, with Alt, or with Ctrl and Command together', () => {
    expect(previewShortcut(press({ code: 'KeyS', shiftKey: false }))).toBeUndefined()
    expect(previewShortcut(press({ code: 'KeyS', altKey: true }))).toBeUndefined()
    expect(previewShortcut(press({ code: 'KeyS', metaKey: true }))).toBeUndefined()
    expect(previewShortcut(press({ code: 'KeyS', ctrlKey: false }))).toBeUndefined()
    expect(previewShortcut(press({ code: 'KeyQ' }))).toBeUndefined()
  })

  it('never fires inside a field, and does fire on a button or a checkbox', () => {
    const inField = (target: object) => previewShortcut(press({ code: 'KeyS', target }))
    expect(inField({ tagName: 'INPUT', type: 'text' })).toBeUndefined()
    expect(inField({ tagName: 'INPUT' })).toBeUndefined()
    expect(inField({ tagName: 'TEXTAREA' })).toBeUndefined()
    expect(inField({ tagName: 'SELECT' })).toBeUndefined()
    expect(inField({ tagName: 'DIV', isContentEditable: true })).toBeUndefined()
    expect(inField({ tagName: 'INPUT', type: 'checkbox' })).toEqual({ action: 'static' })
    expect(inField({ tagName: 'BUTTON' })).toEqual({ action: 'static' })
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('the protocol the admin speaks', () => {
  it('speaks the envelope version of its own release', () => {
    expect(SPOKEN_VERSIONS).toEqual([PREVIEW_PROTOCOL_VERSION])
  })
})
