/** The plugin's configuration, under `micelio.config` in the host's `config/plugins`. */
export interface PluginConfig {
  /**
   * When the scheduler looks for `scheduled` entries whose `publishAt` has passed, as a cron rule,
   * or `false` to turn the scheduler off: scheduled entries then wait for `transitions.publishDue`.
   *
   * @defaultValue `'* * * * *'`, every minute.
   */
  scheduledPublishRule: string | false
}

const DEFAULT_CONFIG: PluginConfig = {
  scheduledPublishRule: '* * * * *',
}

export default {
  default: DEFAULT_CONFIG,
  validator(config: Partial<PluginConfig>): void {
    const rule = config.scheduledPublishRule
    if (rule !== false && (typeof rule !== 'string' || rule.trim() === '')) {
      throw new Error('micelio: scheduledPublishRule must be a cron rule or false')
    }
  },
}
