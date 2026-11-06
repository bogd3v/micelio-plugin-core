import type { TemplateContent, TemplateSummary } from '../../../server/src/types/page-templates'

/** What the Save as template dialog decides for a block: what is kept of its content, and whether it is fixed. */
export interface BlockChoice {
  content: TemplateContent
  fixed: boolean
}

/** The options of a block as a line a person reads: `layout split · tone default`. */
export function optionsLine(options: Record<string, string>): string {
  return Object.entries(options)
    .map(([name, value]) => `${name} ${value}`)
    .join(' · ')
}

/** The blocks of a template as the card lists them: `Hero, Feature grid`; the names come from the site's catalogue. */
export function blockNamesLine(
  blocks: TemplateSummary['blocks'],
  nameOf: (id: string) => string
): string {
  return blocks.map(({ block }) => nameOf(block)).join(', ')
}

/** A file name for the JSON of a template: its name, lowercase, with dashes. */
export function templateFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'template'}.micelio-template.json`
}

/** A site as the gallery lists it. */
export interface TemplateSiteOption {
  slug: string
  name: string
  isDefault: boolean
}
