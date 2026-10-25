// What a content type declares about its export (`docs/export-format.md`, "How a type declares its
// export"): its export name, and whether it or one of its attributes is personal or never written.

/** How much of a type or an attribute an archive holds. */
export type ExportPolicy = 'always' | 'personal' | 'never'

interface Declared {
  pluginOptions?: { micelio?: { exportName?: unknown; export?: unknown } }
}

const NAME = /^[a-z0-9][a-z0-9.-]{0,63}$/

/**
 * The export name of a content type: what an archive calls it, whatever its UID becomes.
 *
 * @remarks
 * A type may declare it as `pluginOptions.micelio.exportName`. Otherwise it is the singular name
 * for `api::` types and the types of this plugin, and `<plugin>.<singular name>` for the types of
 * another plugin.
 */
export function exportNameOf(
  uid: string,
  schema: Declared & { info?: { singularName?: string } }
): string {
  const declared = schema.pluginOptions?.micelio?.exportName
  const [namespace = '', path = ''] = uid.split('::')
  const singular = schema.info?.singularName ?? path.split('.').at(-1) ?? ''
  const name =
    typeof declared === 'string'
      ? declared
      : namespace === 'api' || path.startsWith('micelio.')
        ? singular
        : `${path.split('.')[0]}.${singular}`
  if (!NAME.test(name)) throw new Error(`${uid} has no valid export name: "${name}"`)
  return name
}

/** Whether a type or an attribute is written always, only in a personal archive, or never. */
export function exportPolicyOf(
  declared: Declared & { private?: unknown; type?: unknown }
): ExportPolicy {
  const policy = declared.pluginOptions?.micelio?.export
  if (declared.type === 'password') return 'never'
  if (policy === 'personal' || policy === 'never') return policy
  // A private attribute is never returned by an API; it leaves the CMS only when it says so
  // (`always` is how the site sections, private for the content API, travel in the archive).
  if (policy === 'always') return 'always'
  return declared.private === true ? 'never' : 'always'
}

/** Whether an archive with or without personal data writes what has this policy. */
export function isWritten(policy: ExportPolicy, personal: boolean): boolean {
  return policy === 'always' || (policy === 'personal' && personal)
}
