import { useFetchClient } from '@strapi/strapi/admin'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  visibilityOf,
  type PageSettingsValues,
  type Visibility,
} from '../utils/builder/pageSettings'
import { seoOf, type SeoValues } from '../utils/builder/seo'
import { redo, remember, undo, type History, EMPTY_HISTORY } from '../utils/builder/history'
import {
  adoptIds,
  forgetGoneItems,
  forgetUnknownIds,
  readBlocks,
  storedIds,
  writeBlocks,
  ZONE,
  type BuilderBlock,
  type ComponentSchemas,
} from '../utils/builder/model'
import {
  EXPECTED_VERSION_HEADER,
  refusalOf,
  VERSION_CONFLICT,
  type SaveRefusal,
} from '../utils/builder/refusal'
import { statusOf } from '../utils/fetchError'
import type { EditorialState } from '../utils/review'
import { SAVE_POLL_MS } from '../utils/previewPane'

/** The content type of a site; the Content Manager reads the page's site from it. */
const SITE_UID = 'plugin::micelio.site'

/** No schemas: ids are left as they are, for a page whose catalogue is not known. */
const NO_SCHEMAS: ComponentSchemas = {}

/** How long the page waits after the last change before it saves, in milliseconds. */
const AUTOSAVE_MS = 700

/** The document as the Content Manager's API answers it, reduced to what the builder shows. */
export interface BuilderDocument {
  title: string
  /** `null` for a type that is not localised. */
  locale: string | null
  /** The page type (`landing`, `standard`, …) when the type has the attribute, else `undefined`. */
  pageType: string | undefined
  /** Whether the content type was made with `withPageSettings`: it has a page type and a visibility. */
  hasPageSettings: boolean
  /** The page's slug, `''` when it has none. */
  slug: string
  /** Where the page shows up; the defaults while the component was never saved. */
  visibility: Visibility
  /** Whether the content type has the `seo` component: it has the SEO and social tab. */
  hasSeo: boolean
  /** The page's `shared.seo` as stored; empty values while it was never saved. */
  seo: SeoValues
  /** The slug of the page's site, when the answer names it. */
  site: string | undefined
  /** The name of the page's site, for the texts an editor reads; its slug when it has no name. */
  siteName: string | undefined
  /** The sample texts the page copied from its template and has not replaced yet; empty for a page that has none. */
  samples: string[]
  /** The blocks the page's template fixed: `{ block, nth }`, the nth block of that catalogue id. */
  fixed: { block: string; nth: number }[]
  /** The blocks of the zone as the page was loaded: a mark is read against these, by row. */
  held: { component: string; id?: number }[]
  /** `draft` while no version is published, `published` or `modified` after. */
  state: 'draft' | 'published' | 'modified'
  /** Where the page is in the editorial workflow; `undefined` for a type made without `withEditorial`. */
  editorial: EditorialFacts | undefined
}

/** The editorial component of the draft, as the builder shows it (issue #57). */
export interface EditorialFacts {
  state: EditorialState
  /** When a scheduled page publishes, as an ISO 8601 date. */
  publishAt: string | null
  /** The note of the last transition: for the reviewer, or why the page was sent back. */
  note: string | null
}

const EDITORIAL_STATES = new Set(['draft', 'in_review', 'scheduled', 'published'])

/** The editorial component of an answer of the Content Manager, when the type has one. */
function editorialOf(data: Record<string, unknown>): EditorialFacts | undefined {
  const component = data.editorial as Record<string, unknown> | null | undefined
  if (!('editorial' in data)) return undefined
  const state = component?.state
  return {
    state:
      typeof state === 'string' && EDITORIAL_STATES.has(state)
        ? (state as EditorialState)
        : 'draft',
    publishAt: text(component?.publishAt) ?? null,
    note: text(component?.note) ?? null,
  }
}

/** Where autosave stands; `incomplete` while a block lacks a required field, which holds the save. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict' | 'incomplete'

/** What the page knows of the document. */
export type DocumentResource =
  | { kind: 'loading' }
  | { kind: 'ready'; document: BuilderDocument }
  | { kind: 'error'; status: number | undefined }

interface CmAnswer {
  data: Record<string, unknown>
  meta?: { availableStatus?: { updatedAt?: unknown }[] }
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

function toDocument(answer: CmAnswer, documentId: string): BuilderDocument {
  const { data, meta } = answer
  const site = data.site as { slug?: unknown; name?: unknown } | null | undefined
  const other = meta?.availableStatus?.[0]
  const published = typeof other?.updatedAt === 'string' ? other.updatedAt : undefined
  const updatedAt = text(data.updatedAt)
  return {
    title: text(data.title) ?? text(data.name) ?? text(data.slug) ?? documentId,
    locale: text(data.locale) ?? null,
    pageType: text(data.pageType) ?? ('pageType' in data ? 'standard' : undefined),
    hasPageSettings: 'pageType' in data,
    slug: text(data.slug) ?? '',
    visibility: visibilityOf(data.visibility),
    hasSeo: 'seo' in data,
    seo: seoOf(data.seo),
    site: text(site?.slug),
    siteName: text(site?.name) ?? text(site?.slug),
    samples: Array.isArray(data.templateSamples)
      ? data.templateSamples.filter((sample): sample is string => typeof sample === 'string')
      : [],
    fixed: Array.isArray(data.templateFixed)
      ? data.templateFixed.filter(
          (mark): mark is { block: string; nth: number } =>
            typeof mark === 'object' &&
            mark !== null &&
            typeof (mark as { block?: unknown }).block === 'string' &&
            typeof (mark as { nth?: unknown }).nth === 'number'
        )
      : [],
    held: [],
    state:
      meta?.availableStatus === undefined || meta.availableStatus.length === 0
        ? 'draft'
        : published && updatedAt && new Date(updatedAt) > new Date(published)
          ? 'modified'
          : 'published',
    editorial: editorialOf(data),
  }
}

/** The settings the Content Manager's answer to a save carries, over what the page showed. */
function settingsOf(
  saved: Record<string, unknown>,
  now: BuilderDocument
): Partial<BuilderDocument> {
  return {
    slug: text(saved.slug) ?? now.slug,
    pageType: text(saved.pageType) ?? now.pageType,
    visibility: 'visibility' in saved ? visibilityOf(saved.visibility) : now.visibility,
    seo: 'seo' in saved ? seoOf(saved.seo) : now.seo,
    editorial: editorialOf(saved) ?? now.editorial,
  }
}

// A version names an instant; the frame and the CMS may write it differently.
const instant = (version: string): string => String(new Date(version).getTime())

const shortOf = (list: BuilderBlock[]) => list.map(({ key, component }) => ({ key, component }))

/** What {@link useBuilderDocument} gives the page. */
export interface BuilderState {
  resource: DocumentResource
  blocks: BuilderBlock[]
  /** Whether the blocks differ from what the CMS holds. */
  isDirty: boolean
  /** Replaces the page's blocks; `isUndoable` false for a change that is not a step (typing in a field). */
  edit: (next: BuilderBlock[], isUndoable?: boolean) => void
  /** Goes back one step; `false` when there is nothing to go back to. */
  undo: () => boolean
  canUndo: boolean
  /** Goes forward one step an undo went back from; `false` when there is none. */
  redo: () => boolean
  canRedo: boolean
  status: SaveStatus
  /** When the last save finished, as a time. */
  savedAt: number | undefined
  /** How many saves finished; the page reloads the frame when it goes up. */
  savedCount: number
  /** The `updatedAt` of the draft the CMS holds after the last save or read. */
  version: string | undefined
  /** Why the last save was refused, until the next one succeeds or an undo brings the page back to what the CMS holds. */
  refusal: SaveRefusal | undefined
  /**
   * The blocks the CMS held at a version, in order: what a frame that rendered that version shows.
   * The frame addresses a block by its position in that render, so a click is mapped back with this.
   */
  blocksAt: (version: string) => Pick<BuilderBlock, 'key' | 'component'>[] | undefined
  /** Saves now instead of after the pause. */
  saveNow: () => void
  /**
   * Saves the page settings (the drawer's General tab) over the version the page holds, once any
   * save in flight has finished, and gives the page its new version. `undefined` when it was
   * saved, else why the server refused it.
   */
  saveSettings: (values: Partial<PageSettingsValues>) => Promise<SaveRefusal | undefined>
  /** Another session saved: take its version and drop this session's changes. */
  loadTheirs: () => void
  /** Another session saved: keep this session's changes and overwrite theirs on the next save. */
  keepMine: () => void
  /**
   * Reads the draft again after a transition, which writes it: the page takes its version and its
   * state, and keeps its blocks, which the transition did not change.
   */
  adopt: () => Promise<void>
  /** How many saves moved a scheduled page back to draft (an edit cancels its schedule). */
  scheduleResets: number
}

/**
 * Reads the draft of one document and keeps the blocks of its dynamic zone saved while the editor
 * composes: autosave after a pause, one save at a time, undo for the session, and a stop when
 * another session saved first.
 *
 * @remarks
 * The Content Manager's API has no version check, so the plugin adds one on the server: each
 * save names the `updatedAt` it read in `X-Micelio-Expected-Version`, and the server refuses it
 * (`versionConflict`) when the draft is another one, in the same turn as the write. Every few
 * seconds while the page is in view the hook also reads the draft, to tell the editor early. A
 * different version means another session saved: the page stops saving and offers to load their
 * version or keep this one; nothing is overwritten unasked (`docs/guide/builder.md`).
 *
 * A block that lacks a required field (`isIncomplete`) holds the save: the status says so, and the
 * page is saved once the field has text. Option values are checked by the server at save
 * (`blockOptionInvalid`), and the builder offers only values the block's contract allows.
 *
 * `shape` gives the block as it is sent: the page uses it to leave out the options a block does
 * not expose, which the CMS refuses, though the content API stores a default for them.
 */
export function useBuilderDocument(
  uid: string,
  documentId: string,
  locale: string | null,
  shape: (block: BuilderBlock) => BuilderBlock = (block) => block,
  isIncomplete: (block: BuilderBlock) => boolean = () => false,
  schemas: ComponentSchemas = NO_SCHEMAS
): BuilderState {
  // The client is rebuilt on every render; the effects must not depend on it.
  const client = useFetchClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const [resource, setResource] = useState<DocumentResource>({ kind: 'loading' })
  const [blocks, setBlocks] = useState<BuilderBlock[]>([])
  const [history, setHistory] = useState<History>(EMPTY_HISTORY)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [savedAt, setSavedAt] = useState<number>()
  const [savedCount, setSavedCount] = useState(0)
  const [version, setVersion] = useState<string>()
  const [refusal, setRefusal] = useState<SaveRefusal>()
  const [reloads, setReloads] = useState(0)
  const [scheduleResets, setScheduleResets] = useState(0)
  const resourceRef = useRef(resource)
  resourceRef.current = resource
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const knownRef = useRef<string>()
  const baselineRef = useRef('[]')
  const storedRef = useRef(new Set<string>())
  // The zone as the CMS holds it: what an id must still name when an undo brings a block back.
  const heldRef = useRef<BuilderBlock[]>([])
  const schemasRef = useRef(schemas)
  schemasRef.current = schemas
  const isSavingRef = useRef(false)
  const wantsAgainRef = useRef(false)
  const savesRef = useRef(0)
  const rendersRef = useRef(new Map<string, Pick<BuilderBlock, 'key' | 'component'>[]>())
  const shapeRef = useRef(shape)
  shapeRef.current = shape
  const incompleteRef = useRef(isIncomplete)
  incompleteRef.current = isIncomplete
  // The content a save was refused for: the page does not send it again until it changes or Save is pressed.
  const failedRef = useRef<string>()
  const statusRef = useRef(status)
  statusRef.current = status
  const path = `/content-manager/collection-types/${uid}/${documentId}`
  const params = locale ? { locale } : {}

  const read = useCallback(async () => {
    const answer = await clientRef.current.get<CmAnswer>(path, { params })
    return answer.data
  }, [path, locale])

  const readSite = useCallback(async (): Promise<
    { slug: string | undefined; name: string | undefined } | undefined
  > => {
    const api = clientRef.current
    const related = await api.get<{
      results?: { documentId?: unknown; slug?: unknown; name?: unknown; locale?: unknown }[]
    }>(`/content-manager/relations/${uid}/${documentId}/site`, { params })
    const found = related.data.results?.[0]
    // The relations route answers with the site's own fields, which a role may read through the page.
    if (text(found?.slug)) return { slug: text(found?.slug), name: text(found?.name) }
    const siteId = text(found?.documentId)
    if (!siteId) return undefined
    const siteLocale = text(found?.locale)
    const site = await api.get<{ data?: { slug?: unknown; name?: unknown } }>(
      `/content-manager/collection-types/${SITE_UID}/${siteId}`,
      { params: siteLocale ? { locale: siteLocale } : {} }
    )
    return { slug: text(site.data.data?.slug), name: text(site.data.data?.name) }
  }, [uid, documentId, locale])

  // The first read, and again when the editor takes the other session's version.
  useEffect(() => {
    let isCurrent = true
    setResource({ kind: 'loading' })
    void (async () => {
      try {
        const answer = await read()
        if (!isCurrent) return
        const loaded = readBlocks(answer.data[ZONE])
        knownRef.current = text(answer.data.updatedAt)
        storedRef.current = storedIds(loaded)
        heldRef.current = loaded
        baselineRef.current = JSON.stringify(writeBlocks(loaded))
        setBlocks(loaded)
        if (knownRef.current) rendersRef.current.set(instant(knownRef.current), shortOf(loaded))
        setHistory(EMPTY_HISTORY)
        setVersion(knownRef.current)
        setRefusal(undefined)
        setStatus('idle')
        const document = toDocument(answer, documentId)
        document.held = loaded.map(({ component, id }) => ({ component, id }))
        // The Content Manager's answer carries no relations: the site comes from its relations route.
        if (!document.site) {
          try {
            const site = await readSite()
            document.site = site?.slug
            document.siteName = site?.name ?? site?.slug
          } catch {
            // A role that may not read sites: the page says it cannot find the catalogue for lack of one.
          }
        }
        if (!isCurrent) return
        setResource({ kind: 'ready', document })
      } catch (error) {
        if (isCurrent) setResource({ kind: 'error', status: statusOf(error) })
      }
    })()
    return () => {
      isCurrent = false
    }
  }, [read, readSite, documentId, reloads])

  const flush = useCallback(async () => {
    if (isSavingRef.current) {
      wantsAgainRef.current = true
      return
    }
    const snapshot = blocksRef.current
    const body = JSON.stringify(writeBlocks(snapshot))
    if (body === baselineRef.current || statusRef.current === 'conflict') return
    // Required fields are validated at save: a page with an empty one is not sent.
    if (snapshot.some(incompleteRef.current)) {
      setStatus('incomplete')
      return
    }
    isSavingRef.current = true
    setStatus('saving')
    try {
      // The server compares the version with the draft's, in the turn of the write itself.
      const response = await clientRef.current.put<CmAnswer>(
        path,
        { [ZONE]: writeBlocks(snapshot.map(shapeRef.current)) },
        { params, headers: knownRef.current ? { [EXPECTED_VERSION_HEADER]: knownRef.current } : {} }
      )
      savesRef.current += 1
      const saved = response.data.data
      knownRef.current = text(saved.updatedAt)
      setVersion(knownRef.current)
      if (knownRef.current) rendersRef.current.set(instant(knownRef.current), shortOf(snapshot))
      const adopted = adoptIds(snapshot, saved[ZONE], snapshot)
      storedRef.current = storedIds(adopted)
      heldRef.current = adopted
      baselineRef.current = JSON.stringify(writeBlocks(adopted))
      setBlocks((now) => adoptIds(snapshot, saved[ZONE], now))
      // The server moves a scheduled page back to draft on an edit: the page shows the state it saved.
      const editorial = editorialOf(saved)
      if (editorial) {
        const before = resourceRef.current
        if (
          before.kind === 'ready' &&
          before.document.editorial?.state === 'scheduled' &&
          editorial.state === 'draft'
        ) {
          setScheduleResets((count) => count + 1)
        }
        setResource((now) =>
          now.kind === 'ready' ? { kind: 'ready', document: { ...now.document, editorial } } : now
        )
      }
      failedRef.current = undefined
      setRefusal(undefined)
      setSavedAt(Date.now())
      setSavedCount((count) => count + 1)
      setStatus('saved')
    } catch (error) {
      const refused = refusalOf(error)
      if (refused?.code === VERSION_CONFLICT) {
        // Another session saved first: nothing was written, and the editor chooses.
        setStatus('conflict')
      } else {
        failedRef.current = body
        setRefusal(refused ?? { code: 'failed', detail: '' })
        setStatus('failed')
      }
    } finally {
      isSavingRef.current = false
      if (wantsAgainRef.current) {
        wantsAgainRef.current = false
        void flush()
      }
    }
  }, [read, path, locale])

  // Autosave: a pause after the last change.
  useEffect(() => {
    if (resource.kind !== 'ready' || status === 'conflict') return
    const body = JSON.stringify(writeBlocks(blocks))
    if (body === baselineRef.current) {
      // Back at what the CMS holds (an undo, a removal): nothing is pending, so no alert stays.
      if (status === 'incomplete' || status === 'failed') {
        failedRef.current = undefined
        setRefusal(undefined)
        setStatus('idle')
      }
      return
    }
    if (body === failedRef.current) return
    if (blocks.some(incompleteRef.current)) {
      if (status !== 'incomplete') setStatus('incomplete')
      return
    }
    if (status === 'incomplete') {
      setStatus('idle')
      return
    }
    const timer = window.setTimeout(() => void flush(), AUTOSAVE_MS)
    return () => window.clearTimeout(timer)
  }, [blocks, resource.kind, status, flush])

  // Another session's save: read the draft while the page is in view.
  useEffect(() => {
    if (resource.kind !== 'ready') return
    async function check(): Promise<void> {
      if (document.visibilityState !== 'visible' || isSavingRef.current) return
      const before = savesRef.current
      try {
        const current = text((await read()).data.updatedAt)
        // A save of this session that finished while the read ran makes the read stale, not a conflict.
        if (savesRef.current !== before || isSavingRef.current) return
        if (current !== knownRef.current) setStatus('conflict')
      } catch {
        // A failed read keeps what the page shows; the next one tries again.
      }
    }
    const timer = window.setInterval(() => void check(), SAVE_POLL_MS)
    const onVisible = () => void check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [resource.kind, read])

  const saveSettings = useCallback(
    async (values: Partial<PageSettingsValues>): Promise<SaveRefusal | undefined> => {
      // One save at a time: the settings go over the version the zone's save leaves.
      while (isSavingRef.current) await new Promise((resolve) => setTimeout(resolve, 50))
      isSavingRef.current = true
      try {
        const response = await clientRef.current.put<CmAnswer>(path, values, {
          params,
          headers: knownRef.current ? { [EXPECTED_VERSION_HEADER]: knownRef.current } : {},
        })
        const saved = response.data.data
        knownRef.current = text(saved.updatedAt)
        setVersion(knownRef.current)
        // The zone did not change: the version shows the blocks the page holds now.
        if (knownRef.current)
          rendersRef.current.set(instant(knownRef.current), shortOf(heldRef.current))
        setResource((now) =>
          now.kind === 'ready'
            ? { kind: 'ready', document: { ...now.document, ...settingsOf(saved, now.document) } }
            : now
        )
        setSavedAt(Date.now())
        setSavedCount((count) => count + 1)
        return undefined
      } catch (error) {
        const refused = refusalOf(error)
        if (refused?.code === VERSION_CONFLICT) setStatus('conflict')
        return refused ?? { code: 'failed', detail: '' }
      } finally {
        isSavingRef.current = false
        if (wantsAgainRef.current) {
          wantsAgainRef.current = false
          void flush()
        }
      }
    },
    [path, locale, flush]
  )

  // Stable: the frame hook depends on it, and a new function on each render would repost selections.
  const blocksAt = useCallback((at: string) => rendersRef.current.get(instant(at)), [])

  const edit = useCallback((next: BuilderBlock[], isUndoable = true) => {
    // Any change, a step or not, ends what a redo could bring back.
    setHistory((past) =>
      isUndoable
        ? remember(past, blocksRef.current)
        : past.future.length > 0
          ? { ...past, future: [] }
          : past
    )
    setBlocks(next)
  }, [])

  // Blocks and items that the CMS no longer holds lose their ids: Strapi refuses a save naming them.
  const cleanedForCms = useCallback(
    (list: BuilderBlock[]): BuilderBlock[] =>
      forgetGoneItems(
        forgetUnknownIds(list, storedRef.current, schemasRef.current),
        heldRef.current,
        schemasRef.current
      ),
    []
  )

  const goBack = useCallback((): boolean => {
    const step = undo(history, blocksRef.current)
    if (!step) return false
    setHistory(step.history)
    // The history holds ids that a later save or the other session removed: they come back as new.
    setBlocks(cleanedForCms(step.blocks))
    return true
  }, [history, cleanedForCms])

  const goForward = useCallback((): boolean => {
    const step = redo(history, blocksRef.current)
    if (!step) return false
    setHistory(step.history)
    setBlocks(cleanedForCms(step.blocks))
    return true
  }, [history, cleanedForCms])

  return {
    resource,
    blocks,
    isDirty: JSON.stringify(writeBlocks(blocks)) !== baselineRef.current,
    edit,
    undo: goBack,
    canUndo: history.past.length > 0,
    redo: goForward,
    canRedo: history.future.length > 0,
    status,
    savedAt,
    savedCount,
    version,
    refusal,
    blocksAt,
    saveNow: () => {
      failedRef.current = undefined
      void flush()
    },
    saveSettings,
    loadTheirs: () => setReloads((count) => count + 1),
    adopt: async () => {
      while (isSavingRef.current) await new Promise((resolve) => setTimeout(resolve, 50))
      try {
        const answer = await read()
        knownRef.current = text(answer.data.updatedAt)
        setVersion(knownRef.current)
        if (knownRef.current) {
          rendersRef.current.set(instant(knownRef.current), shortOf(heldRef.current))
        }
        const fresh = toDocument(answer, documentId)
        setResource((now) =>
          now.kind === 'ready'
            ? {
                kind: 'ready',
                document: {
                  ...fresh,
                  site: fresh.site ?? now.document.site,
                  siteName: fresh.siteName ?? now.document.siteName,
                },
              }
            : now
        )
      } catch {
        // The next poll reads the draft again and says so if another session wrote it.
      }
    },
    scheduleResets,
    keepMine: () => {
      // Overwriting theirs is the editor's choice: adopt their `updatedAt` and save.
      void (async () => {
        try {
          const theirs = (await read()).data
          knownRef.current = text(theirs.updatedAt)
          // Their save may have removed blocks this session still holds by id: Strapi refuses a
          // save that names a component the document no longer has, so those go in as new ones.
          const held = readBlocks(theirs[ZONE])
          storedRef.current = storedIds(held)
          heldRef.current = held
          // The same holds for an item of a block both sessions hold: theirs may have removed it.
          const mine = cleanedForCms(blocksRef.current)
          blocksRef.current = mine
          setBlocks(mine)
          // The refs are read by `flush` before the next render.
          statusRef.current = 'idle'
          setStatus('idle')
          void flush()
        } catch {
          setStatus('failed')
        }
      })()
    },
  }
}
