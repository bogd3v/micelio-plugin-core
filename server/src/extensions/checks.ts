import type { Core } from '@strapi/strapi'
import { z } from 'zod'
import { CHECK_TIMEOUT_MS } from '../constants/extensions'
import type { PluginCheck } from '../types/status'
import type { Check, ExtensionSite, StatusChecksRegistration } from '../types/extensions'

const text = z.looseObject({ en: z.string().min(1), es: z.string().optional() })
const checkSchema = z.object({
  id: z.string().min(1),
  title: text,
  status: z.enum(['ok', 'warn', 'fail']),
  detail: text.optional(),
  fix: text.optional(),
})

/** The checks of one plugin for one site, or the single failed check that stands for a failed run. */
export async function runPluginChecks(
  log: Pick<Core.Strapi['log'], 'error'>,
  registration: StatusChecksRegistration,
  site: ExtensionSite
): Promise<PluginCheck[]> {
  let timer: NodeJS.Timeout | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`took more than ${CHECK_TIMEOUT_MS / 1000} seconds`)),
        CHECK_TIMEOUT_MS
      )
    })
    const checks = await Promise.race([Promise.resolve(registration.run(site)), timeout])
    return z
      .array(checkSchema)
      .parse(checks)
      .map((check) => ({ ...(check as Check), site: site.documentId }))
  } catch (error) {
    // The cause goes to the log: a plugin's message could carry paths or addresses.
    log.error(`micelio: the checks of ${registration.id} failed for ${site.slug}: ${String(error)}`)
    return [
      {
        id: 'run',
        title: { en: 'The checks could not run', es: 'No se pudieron ejecutar las comprobaciones' },
        status: 'fail',
        detail: {
          en: 'The plugin failed while running its checks; the server log has the cause.',
          es: 'El plugin falló al ejecutar sus comprobaciones; el registro del servidor tiene la causa.',
        },
        site: site.documentId,
      },
    ]
  } finally {
    clearTimeout(timer)
  }
}
