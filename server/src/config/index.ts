/** The plugin's configuration, under `micelio.config` in the host's `config/plugins`. */
export interface PluginConfig {
  /**
   * When the scheduler looks for `scheduled` entries whose `publishAt` has passed, as a cron rule.
   *
   * @defaultValue `'* * * * *'`, every minute.
   */
  scheduledPublishRule: string
}

const DEFAULT_CONFIG: PluginConfig = {
  scheduledPublishRule: '* * * * *',
}

export default {
  default: DEFAULT_CONFIG,
  validator(config: Partial<PluginConfig>): void {
    if (
      typeof config.scheduledPublishRule !== 'string' ||
      config.scheduledPublishRule.trim() === ''
    ) {
      throw new Error('micelio: scheduledPublishRule must be a cron rule')
    }
  },
}
