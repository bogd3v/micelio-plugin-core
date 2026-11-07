/** Whether a block of a template keeps the text of the page it was saved from, or only its options. */
export type TemplateContent = 'sample' | 'clear'

/** One block of a template: its place in the sequence, its options and what is kept of its content. */
export interface TemplateBlock {
  /** The `id` of the block in the catalogue. */
  block: string
  /** The Strapi component that stores it, from the catalogue. */
  component: string
  /** `sample` keeps the text of the block as a greyed hint; `clear` keeps the options and the items, empty. */
  content: TemplateContent
  /** Whether editors of a page made from the template may not remove or move the block. */
  fixed: boolean
  /** The options, the text (when `sample`) and the empty or filled items: never a file or a link. */
  data: Record<string, unknown>
}

/** A shape the template card draws for a block: the thumbnail is rendered from the structure. */
export type ThumbnailShape = 'hero' | 'cards' | 'text' | 'list' | 'media' | 'cta' | 'row'

/** What the Save as template dialog decides for a block of the page, by position. */
export interface BlockChoice {
  content: TemplateContent
  fixed: boolean
}

/** A check of a template, as the dialog lists it. */
export interface TemplateCheck {
  id: 'budget' | 'options' | 'islands' | 'scope' | 'name'
  ok: boolean
  /** The line the dialog shows; the problem detail of a refusal says the same. */
  detail: string
}

/** What a template holds, as the routes answer it. */
export interface TemplateSummary {
  id: string
  name: string
  description: string
  pageTypes: string[]
  scope: 'site' | 'cms'
  origin: 'site' | 'theme'
  version: number
  /** Whether the template is hidden from New page; the pages made from it are untouched. */
  retired: boolean
  /** What the blocks add to a page, in kB, before any content. */
  kb: number
  /** The slug of the site that owns the template. */
  site: string
  blocks: {
    block: string
    options: Record<string, string>
    content: TemplateContent
    fixed: boolean
  }[]
  thumbnail: ThumbnailShape[]
}

/** What the dialog shows for the page a template would be saved from. */
export interface TemplateInspection {
  /** The title of the page. */
  title: string
  /** The name of the page's site, for the scope choice. */
  siteName: string
  /** The page type of the page; the one the dialog starts with. */
  pageType: string
  /** The blocks of the catalogue the page holds, in order. */
  blocks: { block: string; options: Record<string, string>; items: number; isIsland: boolean }[]
  kb: number
  checks: TemplateCheck[]
}

/** The file `micelio template export` writes and `micelio template import` reads. */
export interface TemplateDocument {
  /** The version of this shape. */
  format: number
  name: string
  description: string
  pageTypes: string[]
  scope: 'site' | 'cms'
  origin: 'site' | 'theme'
  version: number
  blocks: TemplateBlock[]
}

/** A block a page's template fixed: the `nth` block (from 1) of the catalogue block `block`. */
export interface FixedMark {
  block: string
  nth: number
}

/** One thing that changed between two versions of a template. */
export interface TemplateChange {
  kind: 'added' | 'removed' | 'fixed' | 'unfixed' | 'option'
  /** The `id` of the block in the catalogue. */
  block: string
  /** `option`: the name of the option and its value before and after. */
  option?: string
  from?: string
  to?: string
  /** `added`: the catalogue id of the block it follows in the template, `null` when it comes first. */
  after?: string | null
}

/** Why a version of a template exists. */
export type TemplateCause = 'save' | 'import' | 'duplicate' | 'edit'

/** A version of a template, as the manage page's history lists it. */
export interface TemplateRevision {
  version: number
  /** When it was made, ISO 8601. */
  at: string
  /** The name of the admin user who made it, when known. */
  by: string | null
  cause: TemplateCause
  /** `save`: the title of the page it was made from; `duplicate`: the name of the original. */
  source?: string
  /** What changed since the version before; empty for the first. */
  changes: TemplateChange[]
}

/** A page made from a template, as the manage page lists it. */
export interface TemplatePage {
  uid: string
  documentId: string
  locale: string | null
  title: string
  /** The version of the template the page started from. */
  version: number
  state: 'draft' | 'published'
}

/** A template as the manage page lists it: with where it is used and its history. */
export interface TemplateManaged extends TemplateSummary {
  /** How many pages were made from it and are still linked to it. */
  usage: { count: number; pages: TemplatePage[] }
  history: TemplateRevision[]
}

/** A template as the builder edits it. */
export interface TemplateEditable {
  id: string
  name: string
  version: number
  site: string
  origin: 'site' | 'theme'
  retired: boolean
  pageTypes: string[]
  blocks: TemplateBlock[]
}

/** What the Template tab of a page's settings shows. */
export interface TemplateOffer {
  /** Whether the page records a template. */
  isLinked: boolean
  /** The template, `null` when the page has none or it no longer exists. */
  template: {
    id: string
    name: string
    version: number
    retired: boolean
    thumbnail: ThumbnailShape[]
  } | null
  /** The version the page started from. */
  version: number | null
  /** When the page was created, ISO 8601. */
  startedAt: string | null
  /** What changed in the template since that version; empty when it did not move on. */
  changes: TemplateChange[]
  /** The blocks the template fixed on this page. */
  fixed: FixedMark[]
}

/** What switching a page to another template keeps, adds and drops. */
export interface TemplateSwitchPlan {
  keeps: string[]
  adds: string[]
  /** What would be lost: the blocks the new template does not have, with whether they hold content. */
  drops: { block: string; position: number }[]
}
