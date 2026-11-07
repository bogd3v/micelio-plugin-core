import type { TemplateChange, TemplateRevision } from '../../../server/src/types/page-templates'

type Translate = (id: string, values?: Record<string, string | number>) => string

/**
 * A change of a template as a line a person reads, for example "Feature grid: default columns 3 → 2
 * (option only)".
 *
 * @param nameOf - The name of a block in the site's catalogue, by its id.
 */
export function changeLine(
  t: Translate,
  change: TemplateChange,
  nameOf: (id: string) => string
): string {
  const block = nameOf(change.block)
  switch (change.kind) {
    case 'added':
      return change.after
        ? t('template.change.added', { block, after: nameOf(change.after) })
        : t('template.change.addedFirst', { block })
    case 'removed':
      return t('template.change.removed', { block })
    case 'fixed':
      return t('template.change.fixed', { block })
    case 'unfixed':
      return t('template.change.unfixed', { block })
    case 'option':
      return t('template.change.option', {
        block,
        option: change.option ?? '',
        from: change.from ?? '',
        to: change.to ?? '',
      })
  }
}

/** Why a version of a template exists, as a line: `created from “Open source”`. */
export function causeLine(t: Translate, revision: TemplateRevision): string {
  switch (revision.cause) {
    case 'save':
      return t('template.history.save', { source: revision.source ?? '' })
    case 'import':
      return t('template.history.import')
    case 'duplicate':
      return t('template.history.duplicate', { source: revision.source ?? '' })
    case 'edit':
      return t('template.history.edit')
  }
}
