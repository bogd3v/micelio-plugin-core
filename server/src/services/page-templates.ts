import type { Core, UID } from '@strapi/strapi'
import { BLOCKS } from '../../../contract/blocks'
import { findBlockOptionViolation } from '../block-options/rules'
import { BlockOptionError } from '../block-options/error'
import { populateOf } from '../block-settings/populate'
import { findBlockNotAllowed, knownPageTypes, settingOf } from '../block-settings/rules'
import { budgetKbOf } from '../budget/rules'
import type { PluginConfig } from '../config'
import { BLOCK_SETTING_UID } from '../constants/blocks'
import {
  TEMPLATE_ID_ATTRIBUTE,
  TEMPLATE_SAMPLES_ATTRIBUTE,
  TEMPLATE_VERSION_ATTRIBUTE,
} from '../constants/page-settings'
import {
  PAGE_TEMPLATE_UID,
  TEMPLATE_CODES,
  TEMPLATE_DESCRIPTION_MAX_LENGTH,
  TEMPLATE_FORMAT,
  TEMPLATE_NAME_MAX_LENGTH,
} from '../constants/page-templates'
import { SITE_UID } from '../constants/site'
import { hasPageSettings } from '../page-settings'
import { TemplateError } from '../page-templates/error'
import {
  blockOfComponent,
  costKbOf,
  optionsSummary,
  parseTemplateDocument,
  samplesOf,
  shapeContent,
  slugOf,
  thumbnailOf,
  type AttributesOf,
} from '../page-templates/rules'
import { SITE_ATTRIBUTE } from '../site-scope'
import type {
  BlockChoice,
  TemplateBlock,
  TemplateCheck,
  TemplateDocument,
  TemplateInspection,
  TemplateSummary,
} from '../types/page-templates'

/** The site a template belongs to or is made for. */
export interface TemplateSite {
  documentId: string
  slug: string
  /** Its name, when the site was read for a dialog. */
  name?: string
}

/** What the dialog sends to save a page as a template, or to look at what that would do. */
export interface TemplateRequest {
  site: TemplateSite
  /** The page the template is made from. */
  uid: string
  documentId: string
  locale?: string | null
  name: string
  description?: string
  /** The page types the template is for; the page's own when empty. */
  pageTypes?: string[]
  scope: 'site' | 'cms'
  /** What is kept of each block of the catalogue the page holds, by position; every block as sample text, not fixed, when absent. */
  blocks?: BlockChoice[]
  /** Whether the caller may read the page's draft in the Content Manager; the route sets it. */
  mayRead?: (draft: Record<string, unknown>) => boolean
}

/** What the gallery sends to make a page from a template. */
export interface PageRequest {
  /** The content type of the page: one made with `withPageSettings`. */
  uid: string
  /** The site the page is made on. */
  site: TemplateSite
  locale?: string
  /** The page's title; the template's name when absent. */
  title?: string
  /** What the Content Manager keeps of the page's data for the caller (its `sanitizeCreateInput`); the route sets it. */
  mayWrite?: (data: Record<string, unknown>) => Promise<Record<string, unknown>>
}

/** The `pageTemplates` service: `strapi.plugin('micelio').service('pageTemplates')`. */
export interface PageTemplatesService {
  /** The site with this `slug`, or `null` when there is none. */
  siteOf(slug: string): Promise<TemplateSite | null>

  /**
   * What the Save as template dialog shows for a page: its blocks with their options, what they
   * weigh and each check, passed or not. It writes nothing and refuses nothing.
   */
  inspect(request: Omit<TemplateRequest, 'name'> & { name?: string }): Promise<TemplateInspection>

  /**
   * Saves a page's blocks as a template at version 1.
   *
   * @throws {@link TemplateError} for a name the site already uses, a block the scope does not
   * allow (naming the site) or a budget the structure alone is over, and `BlockOptionError` for an
   * option the catalogue does not offer.
   */
  save(request: TemplateRequest): Promise<TemplateSummary>

  /** The templates a site may start a page from: its own and the CMS-wide ones, by name. */
  list(site: TemplateSite): Promise<TemplateSummary[]>

  /** The template `documentId`, or `null`. */
  get(documentId: string): Promise<TemplateSummary | null>

  /** The JSON document of a template, which {@link PageTemplatesService.import} reads back. */
  export(documentId: string): Promise<TemplateDocument>

  /**
   * Stores an exported template on a site, as the same template: its name, blocks and version. The
   * checks of a save apply to it.
   *
   * @param raw - The parsed JSON.
   * @param scope - Where it is available; the document's own when absent.
   * @throws {@link TemplateError} for a document that is not a template, or any refusal of a save.
   */
  import(raw: unknown, site: TemplateSite, scope?: 'site' | 'cms'): Promise<TemplateSummary>

  /**
   * Creates a draft page that copies a template's blocks and options: its sample text is recorded so
   * that the page cannot be published until it is replaced, and the page names the template and its version.
   *
   * @throws {@link TemplateError} when the template is not available to the site, or the type cannot hold it.
   */
  createPage(
    templateId: string,
    request: PageRequest
  ): Promise<{ uid: string; documentId: string; locale: string | null }>
}

interface Row extends Record<string, unknown> {
  documentId: string
}

export default ({ strapi }: { strapi: Core.Strapi }): PageTemplatesService => {
  const attributesOf: AttributesOf = (uid) =>
    strapi.components[uid as UID.Component]?.attributes as ReturnType<AttributesOf>
  const query = () => strapi.db.query(PAGE_TEMPLATE_UID as UID.ContentType)
  const budgets = () => strapi.config.get<PluginConfig['budgets']>('plugin::micelio.budgets')

  async function siteOf(slug: string): Promise<TemplateSite | null> {
    const row = (await strapi.db
      .query(SITE_UID as UID.ContentType)
      .findOne({ where: { slug }, select: ['documentId', 'slug', 'name'] })) as TemplateSite | null
    return row ? { documentId: row.documentId, slug: row.slug, name: row.name } : null
  }

  const invalid = (field: string, detail: string) =>
    new TemplateError(400, TEMPLATE_CODES.invalid, detail, { field })

  const summaryOf = (row: Row): TemplateSummary => {
    const blocks = row.blocks as TemplateBlock[]
    const owner = row.site as { slug?: string } | null | undefined
    return {
      id: row.documentId,
      name: String(row.name),
      description: typeof row.description === 'string' ? row.description : '',
      pageTypes: Array.isArray(row.pageTypes) ? (row.pageTypes as string[]) : [],
      scope: row.scope === 'cms' ? 'cms' : 'site',
      origin: row.origin === 'theme' ? 'theme' : 'site',
      version: Number(row.version),
      kb: costKbOf(blocks),
      site: owner?.slug ?? '',
      blocks: blocks.map((block) => ({
        block: block.block,
        options: optionsSummary(block),
        content: block.content,
        fixed: block.fixed,
      })),
      thumbnail: thumbnailOf(blocks),
    }
  }

  const withSite = { site: { select: ['documentId', 'slug'] } }

  async function read(documentId: string): Promise<Row | null> {
    return (await query().findOne({ where: { documentId }, populate: withSite })) as Row | null
  }

  /** The page the template is made from: its draft and the blocks of the catalogue it holds. */
  async function source(
    request: Pick<TemplateRequest, 'uid' | 'documentId' | 'locale' | 'site' | 'mayRead'>
  ) {
    const uid = request.uid as UID.ContentType
    const model = strapi.contentType(uid)
    if (!model) throw invalid('uid', `There is no content type ${request.uid}`)
    const populate = {
      ...populateOf(
        model.attributes,
        (component) => attributesOf(component) as Record<string, unknown> | undefined
      ),
      [SITE_ATTRIBUTE]: { fields: ['documentId'] },
    }
    const draft = (await strapi.documents(uid).findOne({
      documentId: request.documentId,
      locale: request.locale ?? undefined,
      status: 'draft',
      populate,
    } as never)) as Row | null
    const owner = draft?.[SITE_ATTRIBUTE] as { documentId?: string } | null | undefined
    if (!draft || owner?.documentId !== request.site.documentId) {
      throw new TemplateError(404, TEMPLATE_CODES.notFound, 'There is no such page on this site')
    }
    if (request.mayRead && !request.mayRead(draft)) {
      throw new TemplateError(
        403,
        TEMPLATE_CODES.forbidden,
        `This needs the permission to read ${request.uid} in the Content Manager.`
      )
    }
    const entries = Object.entries(model.attributes as Record<string, { type?: string }>)
      .filter(([, attribute]) => attribute.type === 'dynamiczone')
      .flatMap(([name]) => (Array.isArray(draft[name]) ? (draft[name] as Row[]) : []))
      .filter((entry) => blockOfComponent(String(entry.__component)) !== undefined)
    return { draft, entries }
  }

  function structureOf(entries: Row[], choices: BlockChoice[] | undefined): TemplateBlock[] {
    if (choices && choices.length !== entries.length) {
      throw invalid(
        'blocks',
        `The page holds ${entries.length} blocks and ${choices.length} choices came`
      )
    }
    return entries.map((entry, index) => {
      const block = blockOfComponent(String(entry.__component))!
      const choice = choices?.[index] ?? { content: 'sample', fixed: false }
      return {
        block: block.id,
        component: block.schema.component,
        content: choice.content,
        fixed: choice.fixed,
        data: shapeContent(attributesOf, block.schema.component, entry, choice.content),
      }
    })
  }

  /** The block settings of a site by block. */
  async function settingsOf(site: TemplateSite) {
    const rows = (await strapi.db.query(BLOCK_SETTING_UID as UID.ContentType).findMany({
      where: { site: { documentId: site.documentId } },
    })) as Row[]
    return new Map(
      rows.map((row) => [String(row.block), settingOf(String(row.block), row)] as const)
    )
  }

  /** Every check of a template, each with what makes it fail. */
  async function evaluate(
    site: TemplateSite,
    template: Pick<TemplateDocument, 'name' | 'pageTypes' | 'scope' | 'blocks'>
  ): Promise<{ checks: TemplateCheck[]; failure?: Error; kb: number }> {
    const kb = costKbOf(template.blocks)
    const checks: TemplateCheck[] = []
    let failure: Error | undefined
    const refuse = (error: Error) => (failure ??= error)

    const violation = findBlockOptionViolation(
      template.blocks.map((block) => ({ __component: block.component, ...block.data }))
    )
    checks.push({
      id: 'options',
      ok: violation === null,
      detail: violation
        ? `The ${violation.block} block has no ${violation.option} "${String(violation.value)}"`
        : 'Every option is one the catalogue offers',
    })
    if (violation) refuse(new BlockOptionError(violation))

    const types = template.pageTypes.length > 0 ? template.pageTypes : ['standard']
    let budgetCheck: TemplateCheck = {
      id: 'budget',
      ok: true,
      detail: `${kb} kB of ${budgetKbOf(budgets(), site.slug, types[0])} kB ${types[0]} budget (before content)`,
    }
    for (const type of types) {
      const budgetKb = budgetKbOf(budgets(), site.slug, type)
      if (kb > budgetKb) {
        budgetCheck = {
          id: 'budget',
          ok: false,
          detail: `${kb} kB is over the ${budgetKb} kB ${type} budget before any content`,
        }
        refuse(
          new TemplateError(400, TEMPLATE_CODES.overBudget, budgetCheck.detail, {
            pageType: type,
            budgetKb,
            kb,
          })
        )
        break
      }
    }
    checks.push(budgetCheck)

    const islands = template.blocks.filter((block) => {
      return BLOCKS.find((entry) => entry.id === block.block)?.cost.island
    })
    checks.push({
      id: 'islands',
      ok: true,
      detail:
        islands.length === 0
          ? 'No island, no static alternative to require'
          : `${islands.map((block) => block.block).join(', ')}: a page made from it fills in the static alternative before review`,
    })

    const sites =
      template.scope === 'cms'
        ? ((await strapi.db.query(SITE_UID as UID.ContentType).findMany({
            select: ['documentId', 'slug'],
            orderBy: { slug: 'asc' },
          })) as TemplateSite[])
        : [site]
    let scopeCheck: TemplateCheck = {
      id: 'scope',
      ok: true,
      detail:
        template.scope === 'cms'
          ? `Every block is enabled on all ${sites.length} sites`
          : `Every block is enabled on ${site.slug}`,
    }
    scan: for (const other of sites) {
      const settings = await settingsOf(other)
      for (const type of types) {
        const found = findBlockNotAllowed(
          template.blocks.map((block) => block.block),
          [],
          settings,
          type
        )
        if (!found) continue
        const reason =
          found.reason === 'disabled'
            ? `is disabled on ${other.slug}`
            : `is not allowed on ${type} pages of ${other.slug}`
        scopeCheck = { id: 'scope', ok: false, detail: `The ${found.block} block ${reason}` }
        refuse(
          new TemplateError(400, TEMPLATE_CODES.blockNotAllowed, scopeCheck.detail, {
            site: other.slug,
            block: found.block,
            reason: found.reason,
            ...(found.pageType ? { pageType: found.pageType } : {}),
          })
        )
        break scan
      }
    }
    checks.push(scopeCheck)

    const taken =
      template.name !== '' &&
      (await query().count({
        where: { name: { $eqi: template.name }, site: { documentId: site.documentId } },
      })) > 0
    checks.push({
      id: 'name',
      ok: !taken,
      detail: taken
        ? `A template named ${template.name} exists on ${site.slug}`
        : `Name is unique on ${site.slug}`,
    })
    if (taken) {
      refuse(
        new TemplateError(
          409,
          TEMPLATE_CODES.nameTaken,
          `A template named "${template.name}" already exists on ${site.slug}`
        )
      )
    }
    return { checks, failure, kb }
  }

  function validated(request: TemplateRequest): {
    name: string
    description: string
    pageTypes: string[]
  } {
    const name = request.name.trim()
    if (name === '' || name.length > TEMPLATE_NAME_MAX_LENGTH) {
      throw invalid(
        'name',
        `A template needs a name of 1 to ${TEMPLATE_NAME_MAX_LENGTH} characters`
      )
    }
    const description = request.description ?? ''
    if (description.length > TEMPLATE_DESCRIPTION_MAX_LENGTH) {
      throw invalid(
        'description',
        `The description is at most ${TEMPLATE_DESCRIPTION_MAX_LENGTH} characters`
      )
    }
    const known = knownPageTypes(budgets(), request.site.slug)
    const unknown = (request.pageTypes ?? []).find((type) => !known.includes(type))
    if (unknown !== undefined) throw invalid('pageTypes', `This site has no page type "${unknown}"`)
    return { name, description, pageTypes: request.pageTypes ?? [] }
  }

  async function store(site: TemplateSite, template: TemplateDocument): Promise<TemplateSummary> {
    const created = (await strapi.documents(PAGE_TEMPLATE_UID as UID.ContentType).create({
      data: {
        name: template.name,
        description: template.description,
        scope: template.scope,
        origin: 'site',
        pageTypes: template.pageTypes,
        blocks: template.blocks,
        version: template.version,
        thumbnail: thumbnailOf(template.blocks),
        [SITE_ATTRIBUTE]: site.documentId,
      } as never,
    })) as unknown as Row
    return summaryOf((await read(created.documentId))!)
  }

  return {
    siteOf,

    async inspect(request) {
      const { draft, entries } = await source(request)
      const blocks = structureOf(entries, request.blocks)
      const pageType = typeof draft.pageType === 'string' ? draft.pageType : 'standard'
      const known = knownPageTypes(budgets(), request.site.slug)
      const pageTypes = request.pageTypes ?? [known.includes(pageType) ? pageType : 'standard']
      const { checks, kb } = await evaluate(request.site, {
        name: (request.name ?? '').trim(),
        pageTypes,
        scope: request.scope,
        blocks,
      })
      return {
        title: String(draft.title ?? draft.slug ?? request.documentId),
        siteName: request.site.name ?? request.site.slug,
        pageType,
        blocks: blocks.map((block, index) => ({
          block: block.block,
          options: optionsSummary(block),
          items: Object.values(entries[index]).reduce<number>(
            (count, value) => count + (Array.isArray(value) ? value.length : 0),
            0
          ),
          isIsland: BLOCKS.find((entry) => entry.id === block.block)?.cost.island != null,
        })),
        kb,
        checks,
      }
    },

    async save(request) {
      const { name, description, pageTypes } = validated(request)
      const { draft, entries } = await source(request)
      const blocks = structureOf(entries, request.blocks)
      const types =
        pageTypes.length > 0
          ? pageTypes
          : [typeof draft.pageType === 'string' ? draft.pageType : 'standard']
      const template: TemplateDocument = {
        format: TEMPLATE_FORMAT,
        name,
        description,
        pageTypes: types,
        scope: request.scope,
        origin: 'site',
        version: 1,
        blocks,
      }
      const { failure } = await evaluate(request.site, template)
      if (failure) throw failure
      return store(request.site, template)
    },

    async list(site) {
      const rows = (await query().findMany({
        where: { $or: [{ site: { documentId: site.documentId } }, { scope: 'cms' }] },
        populate: withSite,
        orderBy: { name: 'asc' },
      })) as Row[]
      return rows.map(summaryOf)
    },

    async get(documentId) {
      const row = await read(documentId)
      return row ? summaryOf(row) : null
    },

    async export(documentId) {
      const row = await read(documentId)
      if (!row) throw new TemplateError(404, TEMPLATE_CODES.notFound, 'There is no such template')
      return {
        format: TEMPLATE_FORMAT,
        name: String(row.name),
        description: typeof row.description === 'string' ? row.description : '',
        pageTypes: Array.isArray(row.pageTypes) ? (row.pageTypes as string[]) : [],
        scope: row.scope === 'cms' ? 'cms' : 'site',
        origin: row.origin === 'theme' ? 'theme' : 'site',
        version: Number(row.version),
        blocks: row.blocks as TemplateBlock[],
      }
    },

    async import(raw, site, scope) {
      const parsed = parseTemplateDocument(raw, attributesOf, TEMPLATE_FORMAT)
      if ('field' in parsed) throw invalid(parsed.field, parsed.detail)
      const template = { ...parsed, scope: scope ?? parsed.scope }
      validated({ ...template, site, uid: '', documentId: '' })
      const { failure } = await evaluate(site, template)
      if (failure) throw failure
      return store(site, template)
    },

    async createPage(templateId, request) {
      const row = await read(templateId)
      const ownerId = (row?.site as { documentId?: string } | null | undefined)?.documentId
      if (!row || (row.scope !== 'cms' && ownerId !== request.site.documentId)) {
        throw new TemplateError(
          404,
          TEMPLATE_CODES.notFound,
          'There is no such template on this site'
        )
      }
      const uid = request.uid as UID.ContentType
      const model = strapi.contentType(uid)
      if (!model || !hasPageSettings(model)) {
        throw invalid('uid', `${request.uid} is not a page type with page settings`)
      }
      const blocks = row.blocks as TemplateBlock[]
      const attributes = model.attributes as Record<
        string,
        { type?: string; components?: string[] }
      >
      const zone = Object.entries(attributes).find(
        ([, attribute]) =>
          attribute.type === 'dynamiczone' &&
          blocks.every((block) => attribute.components?.includes(block.component))
      )?.[0]
      if (!zone)
        throw invalid('uid', `${request.uid} has no zone that accepts every block of the template`)

      const types = Array.isArray(row.pageTypes) ? (row.pageTypes as string[]) : []
      const title = (request.title ?? '').trim() || String(row.name)
      const data: Record<string, unknown> = {
        [SITE_ATTRIBUTE]: request.site.documentId,
        [zone]: blocks.map((block) => ({
          __component: block.component,
          ...structuredClone(block.data),
        })),
        pageType: types[0] ?? 'standard',
        [TEMPLATE_ID_ATTRIBUTE]: templateId,
        [TEMPLATE_VERSION_ATTRIBUTE]: Number(row.version),
        [TEMPLATE_SAMPLES_ATTRIBUTE]: samplesOf(attributesOf, blocks),
      }
      if ('title' in attributes) data.title = title
      if ('slug' in attributes) {
        const base = slugOf(title)
        let slug = base
        for (let n = 2; (await strapi.db.query(uid).count({ where: { slug } })) > 0; n += 1) {
          slug = `${base}-${n}`
        }
        data.slug = slug
      }
      if (request.mayWrite) {
        const kept = await request.mayWrite(data)
        const refused = [zone, 'title', 'slug', 'pageType'].find(
          (field) => field in data && JSON.stringify(kept[field]) !== JSON.stringify(data[field])
        )
        if (refused) {
          throw new TemplateError(
            403,
            TEMPLATE_CODES.forbidden,
            `This needs the permission to create ${refused} on ${request.uid} in the Content Manager.`
          )
        }
      }
      const created = (await strapi.documents(uid).create({
        data: data as never,
        ...(request.locale ? { locale: request.locale } : {}),
      })) as unknown as Row & { locale?: string | null }
      return { uid: request.uid, documentId: created.documentId, locale: created.locale ?? null }
    },
  }
}
