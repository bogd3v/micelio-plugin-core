// The icon catalogue (ADR-0021): an icon is a name of one set, Tabler Icons at the version pinned
// here, and `@micelio/icons` (`packages/icons/`) ships its glyphs. `npm run icons:generate` writes
// `contract/icons.names.json`, `contract/icons.schema.json` and the index of the package from the
// pinned set, and `npm run lint:icons` fails when any of them drifts. Raising the version follows
// ADR-0021, section 6: adding names is a MINOR of the block contract, and a name Tabler renames or
// removes stays here as an alias of the new one; dropping an alias is a MAJOR.
import { z } from 'zod'
import names from './icons.names.json'

/** The one set the core pins. */
export const ICON_SET = 'tabler'

/**
 * The Tabler Icons version the names and the glyphs come from. It is also the exact version of
 * the `@tabler/icons` dev dependency of `@micelio/icons`: `npm run lint:icons` fails when they differ.
 */
export const TABLER_VERSION = '3.51.0'

/**
 * A name Tabler renamed or removed, and the name of the glyph that replaces it. Content that
 * stores the old name keeps rendering, and the picker finds the new glyph by it. Empty at the
 * first pin: there is no earlier version to have renamed anything.
 */
export const ICON_ALIASES: Readonly<Record<string, string>> = {}

/**
 * The catalogue: the set, its pinned version, every name and the alias table. An alias is never
 * itself a name, and it points to a name.
 */
export const IconCatalogue = z
  .object({
    set: z.literal(ICON_SET),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    names: z.array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)).min(1),
    aliases: z.record(z.string(), z.string()),
  })
  .superRefine((catalogue, context) => {
    const known = new Set(catalogue.names)
    if (known.size !== catalogue.names.length) {
      context.addIssue({ code: 'custom', message: 'a name is listed twice' })
    }
    for (const [old, name] of Object.entries(catalogue.aliases)) {
      if (known.has(old)) {
        context.addIssue({ code: 'custom', message: `the alias ${old} is also a name` })
      }
      if (!known.has(name)) {
        context.addIssue({
          code: 'custom',
          message: `the alias ${old} points to ${name}, not a name`,
        })
      }
    }
  })

/** The shape of {@link IconCatalogue}. */
export type IconCatalogue = z.infer<typeof IconCatalogue>

/** The pinned catalogue. */
export const ICONS: IconCatalogue = {
  set: ICON_SET,
  version: TABLER_VERSION,
  names,
  aliases: { ...ICON_ALIASES },
}

/** The name a stored icon resolves to: itself, or what an alias points to; `undefined` when unknown. */
export function resolveIconName(
  name: string,
  catalogue: Pick<IconCatalogue, 'names' | 'aliases'> = ICONS
): string | undefined {
  const resolved = Object.prototype.hasOwnProperty.call(catalogue.aliases, name)
    ? catalogue.aliases[name]
    : name
  return catalogue.names.includes(resolved) ? resolved : undefined
}

/** The JSON Schema of a catalogue, `contract/icons.schema.json`: a name is one of the pinned ones. */
export function iconsJsonSchema(catalogue: IconCatalogue): Record<string, unknown> {
  const name = z.enum(catalogue.names as [string, ...string[]])
  const schema = z.toJSONSchema(
    z.object({
      set: z.literal(ICON_SET),
      version: z.literal(catalogue.version),
      names: z.array(name),
      aliases: z.record(z.string(), name),
    }),
    { reused: 'ref', target: 'draft-2020-12' }
  )
  return {
    ...schema,
    title: 'Micelio icon catalogue',
    description:
      'The icon names of the block contract: Tabler Icons at the pinned version, and the aliases of names it renamed. ' +
      'Generated from contract/icons.ts of @micelio/strapi-plugin-core (ADR-0021); do not edit.',
  }
}
