import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Core, UID } from '@strapi/strapi'
import packageJson from '../../../package.json'
import { BLOCKS } from '../../../contract/blocks'
import { EDITORIAL_ATTRIBUTE } from '../constants/editorial'
import { SITE_UID } from '../constants/site'
import { readFrontend } from '../host-check/facts'
import { isEditorial } from '../editorial'
import { readSites } from '../status/read'
import type { AboutFrontend, AboutReport, AboutUpdate } from '../types/about'
import type { StatusSite } from '../types/status'
import { checkForUpdate } from './update-check'

/** What the daily check found; the page reads it, it never triggers a request. */
export interface AboutChecks {
  checkedAt: string
  frontends: AboutFrontend[]
  update: AboutUpdate
}

interface SiteRow {
  documentId: string
  slug: string
  isDefault: boolean
  modules?: Record<string, unknown> | null
  theme?: { themeId?: string | null; themeVersion?: string | null } | null
}

/**
 * Asks each site's frontend for `/_health` and reads the release feed, and answers what they said.
 *
 * @param keptUpdate - The feed's last answer: when given, the feed is not read again.
 */
export async function runAboutChecks(
  strapi: Core.Strapi,
  keptUpdate?: AboutUpdate
): Promise<AboutChecks> {
  const sites = await readSites(strapi)
  const frontends = await readFrontends(sites)
  return {
    checkedAt: new Date().toISOString(),
    frontends,
    update: keptUpdate ?? (await checkForUpdate()),
  }
}

async function readFrontends(sites: StatusSite[]): Promise<AboutFrontend[]> {
  const slugs = new Map<string, string[]>()
  for (const { origin, slug } of sites) {
    if (origin) slugs.set(origin, [...(slugs.get(origin) ?? []), slug])
  }
  return Promise.all(
    [...slugs.keys()].sort().map(async (origin) => {
      const started = Date.now()
      const { reachable, version } = await readFrontend(origin)
      return {
        origin,
        sites: slugs.get(origin) ?? [],
        health: reachable ? 'reachable' : 'unavailable',
        ...(version ? { version } : {}),
        ...(reachable ? { ms: Date.now() - started } : {}),
      } satisfies AboutFrontend
    })
  )
}

/**
 * Gathers what the About page shows from the installation and the last checks.
 *
 * @remarks
 * Makes no request: the frontends and the release feed are those of `checks`, which the daily job,
 * the boot and "Run checks again" fill.
 */
export async function readAbout(
  strapi: Core.Strapi,
  checks: AboutChecks | undefined
): Promise<AboutReport> {
  const update: AboutUpdate =
    process.env.MICELIO_UPDATE_CHECK === 'false'
      ? { state: 'off' }
      : (checks?.update ?? { state: 'unknown' })
  const report: Omit<AboutReport, 'diagnostics'> = {
    plugin: { version: packageJson.version, coreLine: packageJson.micelio },
    strapi: {
      version: String(strapi.config.get('info.strapi') ?? ''),
      node: process.versions.node,
    },
    database: await databaseOf(strapi),
    uploads: strapi.config.get<string>('plugin::upload.provider', 'local'),
    isSmtpConfigured: isSmtpConfigured(strapi),
    frontends: checks?.frontends ?? [],
    siblings: siblingPlugins(strapi),
    update,
    checkedAt: checks?.checkedAt ?? null,
  }
  return { ...report, diagnostics: await diagnosticsOf(strapi, report) }
}

/** The `@micelio/*` packages the host enabled next to the core, from their `package.json`. */
function siblingPlugins(strapi: Core.Strapi): AboutReport['siblings'] {
  const plugins = strapi.config.get<Record<string, { enabled?: boolean; resolve?: string }>>(
    'plugins',
    {}
  )
  const found: AboutReport['siblings'] = []
  for (const [id, plugin] of Object.entries(plugins)) {
    if (id === 'micelio' || plugin.enabled === false || !plugin.resolve) continue
    try {
      const root = path.isAbsolute(plugin.resolve)
        ? plugin.resolve
        : path.resolve(strapi.dirs.app.root, plugin.resolve)
      const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
        name?: string
        version?: string
      }
      if (manifest.name?.startsWith('@micelio/') && manifest.version) {
        found.push({ name: manifest.name, version: manifest.version })
      }
    } catch {
      // A plugin without a readable package.json is not listed; the page says what it can read.
    }
  }
  return found.sort((a, b) => (a.name < b.name ? -1 : 1))
}

async function diagnosticsOf(
  strapi: Core.Strapi,
  report: Omit<AboutReport, 'diagnostics'>
): Promise<string> {
  const rows = (await strapi.db.query(SITE_UID as UID.ContentType).findMany({
    select: ['documentId', 'slug', 'isDefault'],
    populate: { modules: true, theme: true },
  })) as SiteRow[]
  const sites = [...new Map(rows.map((row) => [row.documentId, row])).values()].sort((a, b) =>
    a.isDefault === b.isDefault ? (a.slug < b.slug ? -1 : 1) : a.isDefault ? -1 : 1
  )
  const modules = [
    ...new Set(
      sites.flatMap((site) =>
        Object.entries(site.modules ?? {})
          .filter(([name, on]) => on === true && name !== 'id')
          .map(([name]) => name)
      )
    ),
  ].sort()
  const themes = new Map<string, boolean>()
  for (const site of sites) {
    const id = site.theme?.themeId
    if (!id) continue
    const label = `${id} ${site.theme?.themeVersion ?? 'unpinned'}`
    themes.set(label, (themes.get(label) ?? false) || site.isDefault)
  }
  const frontend = report.frontends[0]
  return [
    `micelio-core ${report.plugin.version} · line ${report.plugin.coreLine} · strapi ${report.strapi.version} · node ${report.strapi.node}`,
    frontend
      ? `frontend ${frontend.version ?? 'unknown version'} · health ${frontend.health === 'reachable' ? `ok ${frontend.ms ?? 0} ms` : 'unavailable'}`
      : 'frontend none',
    `sites ${sites.length} (${sites.map((site) => (site.isDefault ? `${site.slug} default` : site.slug)).join(', ')})`,
    `modules on: ${modules.length > 0 ? modules.join(', ') : 'none'}`,
    `themes: ${themes.size > 0 ? [...themes].map(([label, isActive]) => (isActive ? `${label} (active)` : label)).join(', ') : 'none'}`,
    `blocks ${BLOCKS.length} · in review ${await countInReview(strapi)}`,
    `db ${report.database} · uploads ${report.uploads} · smtp ${report.isSmtpConfigured ? 'configured' : 'not configured'}`,
    `generated ${new Date().toISOString()}`,
  ].join('\n')
}

async function countInReview(strapi: Core.Strapi): Promise<number> {
  let total = 0
  for (const [uid, schema] of Object.entries(strapi.contentTypes)) {
    if (!isEditorial(schema)) continue
    try {
      total += await strapi.db.query(uid as UID.ContentType).count({
        where: { [EDITORIAL_ATTRIBUTE]: { state: 'in_review' }, publishedAt: { $null: true } },
      })
    } catch (error) {
      strapi.log.warn(`[micelio] could not count the entries in review of ${uid}: ${String(error)}`)
    }
  }
  return total
}

async function databaseOf(strapi: Core.Strapi): Promise<string> {
  const client = String(strapi.db.config.connection.client)
  try {
    const sql =
      client === 'postgres' ? 'select version() as version' : 'select sqlite_version() as version'
    const result = (await strapi.db.connection.raw(sql)) as
      { rows?: { version: string }[] } | { version: string }[]
    const row = Array.isArray(result) ? result[0] : result.rows?.[0]
    // PostgreSQL answers a sentence ("PostgreSQL 16.4 on …"): only the number is a version.
    const version = /\d+(?:\.\d+)*/.exec(row?.version ?? '')?.[0]
    return version ? `${client} ${version}` : client
  } catch {
    // A database that will not answer a version still has an engine to report.
    return client
  }
}

function isSmtpConfigured(strapi: Core.Strapi): boolean {
  // Strapi's email plugin defaults to `sendmail`, which sends from the server itself.
  const provider = strapi.config.get<string | undefined>('plugin::email.provider')
  return provider !== undefined && provider !== 'sendmail'
}
