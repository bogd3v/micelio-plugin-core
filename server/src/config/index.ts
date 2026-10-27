import { DEFAULT_PAGE_TYPE_BUDGETS_KB } from '../constants/budget'

/** The weight a page may have when it is published, in kB as the frontend sends them (`docs/operate/budgets.md`). */
export interface BudgetsConfig {
  /**
   * The budget of each page type, in kB. A key you set replaces the default of that type; the
   * others keep theirs, and a new key defines a page type of your own.
   *
   * @defaultValue `{ landing: 60, standard: 120, 'long-read': 160 }`
   */
  pageTypes: Record<string, number>
  /**
   * Budgets of one site that differ from `pageTypes`, by the site's `slug` and then page type.
   *
   * @defaultValue `{}`
   */
  sites: Record<string, Record<string, number>>
  /**
   * The content types whose publish is measured, by UID. Only a site-scoped, editorial type with a
   * dynamic zone can be measured; every other type publishes with no measurement, and a listed type
   * the frontend cannot measure is refused with `previewUnavailable`. An empty list measures nothing.
   *
   * @remarks
   * The default is not in the plugin's default config, because Strapi merges arrays index by index:
   * a list of one UID would come back with the second default behind it.
   *
   * @defaultValue `['api::page.page', 'api::article.article']`, the types the frontend previews.
   */
  contentTypes?: string[]
}

/** The plugin's configuration, under `micelio.config` in the host's `config/plugins`. */
export interface PluginConfig {
  /**
   * When the scheduler looks for `scheduled` entries whose `publishAt` has passed, as a cron rule,
   * or `false` to turn the scheduler off: scheduled entries then wait for `transitions.publishDue`.
   *
   * @defaultValue `'* * * * *'`, every minute.
   */
  scheduledPublishRule: string | false
  /**
   * When the host check and the checks of sibling plugins run again on their own, as a cron rule,
   * or `false` to run them only on "Run again".
   *
   * @defaultValue `'0 4 * * *'`, every day at 04:00 server time.
   */
  statusRefreshRule: string | false
  /** The weight budgets a publish is refused above. */
  budgets: BudgetsConfig
}

const DEFAULT_CONFIG: PluginConfig = {
  scheduledPublishRule: '* * * * *',
  statusRefreshRule: '0 4 * * *',
  budgets: { pageTypes: { ...DEFAULT_PAGE_TYPE_BUDGETS_KB }, sites: {} },
}

function isBudget(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

const CONTENT_TYPE_UID = /^(api|plugin)::[a-z0-9-]+\.[a-z0-9-]+$/

function isContentTypeList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((uid) => typeof uid === 'string' && CONTENT_TYPE_UID.test(uid))
  )
}

function isBudgetMap(value: unknown): value is Record<string, number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isBudget)
  )
}

export default {
  default: DEFAULT_CONFIG,
  validator(config: Partial<PluginConfig>): void {
    const { budgets } = config
    if (budgets !== undefined) {
      if (typeof budgets !== 'object' || budgets === null || Array.isArray(budgets)) {
        throw new Error('micelio: budgets must be an object with pageTypes and sites')
      }
      const { pageTypes, sites, contentTypes } = budgets as Partial<BudgetsConfig>
      if (contentTypes !== undefined && !isContentTypeList(contentTypes)) {
        throw new Error(
          'micelio: budgets.contentTypes must be an array of content type UIDs, such as api::page.page'
        )
      }
      if (pageTypes !== undefined && !isBudgetMap(pageTypes)) {
        throw new Error(
          'micelio: budgets.pageTypes must map each page type to a number of kB above 0'
        )
      }
      if (
        sites !== undefined &&
        !(
          typeof sites === 'object' &&
          sites !== null &&
          !Array.isArray(sites) &&
          Object.values(sites).every(isBudgetMap)
        )
      ) {
        throw new Error(
          'micelio: budgets.sites must map each site slug to a map of page types to kB above 0'
        )
      }
    }
    for (const key of ['scheduledPublishRule', 'statusRefreshRule'] as const) {
      const rule = config[key]
      if (
        rule !== undefined &&
        rule !== false &&
        (typeof rule !== 'string' || rule.trim() === '')
      ) {
        throw new Error(`micelio: ${key} must be a cron rule or false`)
      }
    }
  },
}
