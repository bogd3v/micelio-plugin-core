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
}

const DEFAULT_CONFIG: PluginConfig = {
  scheduledPublishRule: '* * * * *',
  statusRefreshRule: '0 4 * * *',
}

export default {
  default: DEFAULT_CONFIG,
  validator(config: Partial<PluginConfig>): void {
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
