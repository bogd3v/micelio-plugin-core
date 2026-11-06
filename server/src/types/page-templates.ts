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
