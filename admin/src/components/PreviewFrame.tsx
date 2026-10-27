import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react'
import styled from 'styled-components'

import {
  PREVIEW_PROTOCOL_VERSION,
  parsePreviewMessage,
  type PreviewMessage,
} from '../../../contract/preview'
import { READY_WAIT_SECONDS, SPOKEN_VERSIONS } from '../utils/previewPane'

/** Whether the frame said it speaks a version the admin speaks. */
export type FrameProtocol = 'waiting' | 'ok' | 'upgrade'

/** What the frame reports to the page. */
export interface FrameState {
  /** What the frame in view said with `ready`. */
  protocol: FrameProtocol
  /** The versions the frame listed in its `ready`, once it sent one. */
  versions: number[]
  /** A frame is loading, or the one in view is loading the draft again after a `load-draft`. */
  isBusy: boolean
  /**
   * The frame in view loaded and said no `ready` within `READY_WAIT_SECONDS`. The admin cannot read the
   * frame, so a cookie the browser refused (a 404 page) and a frontend that never says `ready` look the
   * same; a `ready` from any frame of the site clears it, and a reload keeps it until then.
   */
  isSilent: boolean
}

/** What the page can ask of the frame. */
export interface PreviewFrameHandle {
  /**
   * Tells the frame in view to load the draft again, with `load-draft` to the site's origin only.
   *
   * @returns `false` when the frame has not said `ready` with a version the admin speaks: nothing was
   * sent, and the page loads the preview again with a new token.
   */
  loadDraft: () => boolean
}

interface PreviewFrameProps {
  /** The URL to load; a new value loads it in a frame of its own, and the old render stays until it is ready. */
  src: string | undefined
  /** The site's origin: the only one the page posts to and reads messages from. */
  origin: string | undefined
  documentId: string
  /** `null` for a type that is not localised. */
  locale: string | null
  title: string
  /** The width of the page in the frame, in pixels; the frame never grows past its column. */
  width: number
  onChange: (state: FrameState) => void
  /** The admin's Content Security Policy refused to frame `origin`. */
  onBlocked: () => void
  /**
   * A notice covers the frames: they leave the tab order and the accessibility tree, and still take
   * messages, so a late `ready` can lift the cover.
   */
  isCovered?: boolean
}

type Phase = 'loading' | 'shown' | 'leaving'

interface Layer {
  key: number
  src: string
  phase: Phase
  /** The frame fired `load`. */
  isLoaded: boolean
}

// The slowest motion token (the Motion artboard): how long the old render takes to fade out. With
// `prefers-reduced-motion` the transition lasts 1 ms and this only delays removing the old frame.
const FADE_OUT_MS = 400

const NO_VERSIONS: number[] = []

const Stage = styled.div<{ $width: number }>`
  position: relative;
  box-sizing: border-box;
  width: min(${({ $width }) => $width}px, 100%);
  max-width: 100%;
  height: 100%;
  min-height: 32rem;
  margin-inline: auto;
  background: #ffffff;
  box-shadow: 0 0 0 1px #dcdce4;
  border-radius: 4px;
  overflow: hidden;
  transition: width var(--m-base) cubic-bezier(0.2, 0, 0, 1);
`

// The old render stays in view until the new one has loaded, then the two cross-fade.
const FrameLayer = styled.iframe<{ $phase: Phase }>`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: #ffffff;
  opacity: ${({ $phase }) => ($phase === 'shown' ? 1 : 0)};
  visibility: ${({ $phase }) => ($phase === 'loading' ? 'hidden' : 'visible')};
  pointer-events: ${({ $phase }) => ($phase === 'shown' ? 'auto' : 'none')};
  transition: opacity var(--m-slow) linear;
`

/**
 * The preview iframe of the preview page (ADR-0019, sections 4 and 5): loads the URL the token route
 * answered, listens for `ready` from the site's origin only and posts `load-draft` to it.
 *
 * @remarks
 * Messages from another origin or window, or that fail the schema of `contract/preview.ts`, are dropped.
 * The iframe is sandboxed as the ADR says. A new `src` loads in a second frame stacked on the first,
 * which the page shows once it has loaded.
 */
export const PreviewFrame = forwardRef(function PreviewFrame(
  props: PreviewFrameProps,
  ref: Ref<PreviewFrameHandle>
) {
  const { src, origin, documentId, locale, title, width, onChange, onBlocked, isCovered } = props
  const [layers, setLayers] = useState<Layer[]>([])
  const [isUpdating, setIsUpdating] = useState(false)
  // The origin whose frame stayed silent: a new frame of it (a reload) keeps the notice until one says `ready`.
  const [silentOrigin, setSilentOrigin] = useState<string>()
  const [protocol, setProtocol] = useState<{
    key: number
    protocol: FrameProtocol
    versions: number[]
  }>({ key: -1, protocol: 'waiting', versions: NO_VERSIONS })
  const frames = useRef(new Map<number, HTMLIFrameElement>())
  const protocols = useRef(new Map<number, { protocol: FrameProtocol; versions: number[] }>())
  const nextKey = useRef(0)
  const shown = layers.find((layer) => layer.phase === 'shown')
  const shownKey = shown?.key
  const isShownLoaded = shown?.isLoaded === true
  const timers = useRef<number[]>([])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onBlockedRef = useRef(onBlocked)
  onBlockedRef.current = onBlocked

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer)
    },
    []
  )

  useEffect(() => {
    if (!src) {
      setLayers([])
      return
    }
    const key = nextKey.current++
    // The first frame is in view at once; a later one waits, hidden, until it has loaded.
    setLayers((current) => [
      ...current,
      { key, src, phase: current.length === 0 ? 'shown' : 'loading', isLoaded: false },
    ])
  }, [src])

  useEffect(() => {
    if (!origin) return
    function onViolation(event: SecurityPolicyViolationEvent): void {
      const isFrameDirective = ['frame-src', 'child-src', 'default-src'].includes(
        event.effectiveDirective
      )
      if (isFrameDirective && event.blockedURI.startsWith(origin as string)) onBlockedRef.current()
    }
    document.addEventListener('securitypolicyviolation', onViolation)
    return () => document.removeEventListener('securitypolicyviolation', onViolation)
  }, [origin])

  // What a removed frame said goes with it.
  useEffect(() => {
    for (const key of protocols.current.keys()) {
      if (!layers.some((layer) => layer.key === key)) protocols.current.delete(key)
    }
  }, [layers])

  const reveal = useCallback((key: number) => {
    setLayers((current) => {
      if (current.find((layer) => layer.key === key)?.phase !== 'loading') return current
      return current.map((layer) =>
        layer.key === key
          ? { ...layer, phase: 'shown' }
          : layer.phase === 'shown'
            ? { ...layer, phase: 'leaving' }
            : layer
      )
    })
    timers.current.push(
      window.setTimeout(
        () => setLayers((current) => current.filter((layer) => layer.phase !== 'leaving')),
        FADE_OUT_MS
      )
    )
  }, [])

  useEffect(() => {
    if (!origin) return
    function onMessage(event: MessageEvent): void {
      if (event.origin !== origin) return
      const key = [...frames.current].find(([, frame]) => frame.contentWindow === event.source)?.[0]
      if (key === undefined) return
      const message = parsePreviewMessage(event.data)
      if (message?.type !== 'ready') return
      if (message.payload.documentId !== documentId || message.payload.locale !== locale) return
      const versions = message.payload.v
      const state = {
        protocol: SPOKEN_VERSIONS.some((spoken) => versions.includes(spoken))
          ? ('ok' as const)
          : ('upgrade' as const),
        versions,
      }
      protocols.current.set(key, state)
      setProtocol({ key, ...state })
      setSilentOrigin(undefined)
      setIsUpdating(false)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [origin, documentId, locale])

  useImperativeHandle(
    ref,
    () => ({
      loadDraft() {
        const frame = shownKey === undefined ? undefined : frames.current.get(shownKey)
        if (
          !origin ||
          !frame?.contentWindow ||
          protocols.current.get(shownKey ?? -1)?.protocol !== 'ok'
        ) {
          return false
        }
        const message = {
          v: PREVIEW_PROTOCOL_VERSION,
          type: 'load-draft',
          payload: { documentId, locale },
        } satisfies PreviewMessage
        frame.contentWindow.postMessage(message, origin)
        setIsUpdating(true)
        return true
      },
    }),
    [shownKey, origin, documentId, locale]
  )

  // The clock starts when the frame in view has loaded, and a `ready` from it stops the wait.
  const hasSaidReady = protocol.key === shownKey
  useEffect(() => {
    if (shownKey === undefined || !origin || !isShownLoaded || hasSaidReady) return
    const timer = window.setTimeout(() => setSilentOrigin(origin), READY_WAIT_SECONDS * 1000)
    return () => window.clearTimeout(timer)
  }, [shownKey, isShownLoaded, hasSaidReady, origin])

  const inView =
    protocol.key === shownKey ? protocol : { protocol: 'waiting' as const, versions: NO_VERSIONS }
  const isBusy = isUpdating || layers.some((layer) => layer.phase === 'loading')
  const isSilent =
    shownKey !== undefined && origin !== undefined && silentOrigin === origin && !hasSaidReady
  useEffect(() => {
    onChangeRef.current({
      protocol: inView.protocol,
      versions: inView.versions,
      isBusy,
      isSilent,
    })
  }, [inView.protocol, inView.versions, isBusy, isSilent])

  return (
    <Stage $width={width}>
      {layers.map((layer) => (
        <FrameLayer
          key={layer.key}
          $phase={layer.phase}
          src={layer.src}
          title={title}
          {...(isCovered ? { inert: '', 'aria-hidden': true, tabIndex: -1 } : {})}
          sandbox="allow-scripts allow-same-origin allow-forms"
          referrerPolicy="no-referrer"
          ref={(frame: HTMLIFrameElement | null) => {
            if (frame) frames.current.set(layer.key, frame)
            else frames.current.delete(layer.key)
          }}
          onLoad={() => {
            setLayers((current) =>
              current.map((item) => (item.key === layer.key ? { ...item, isLoaded: true } : item))
            )
            reveal(layer.key)
            // The frame loaded the draft again after a `load-draft`.
            if (layer.phase === 'shown') setIsUpdating(false)
          }}
        />
      ))}
    </Stage>
  )
})
