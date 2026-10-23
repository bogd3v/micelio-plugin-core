#!/usr/bin/env node
// The `micelio` command, run in the folder of a Strapi project with the plugin enabled. It loads
// the project as `strapi console` does.
//
// - `micelio doctor` runs the host check of @micelio/strapi-plugin-core and prints every check. It
//   exits with 1 when a required check fails, so a deploy script can stop on it.
//   docs/operate/host-check.md has more.
// - `micelio export <site> [--personal] [--output <file>]` writes the archive of one site
//   (docs/export-format.md) and prints where.

const fs = require('node:fs')
const path = require('node:path')

const USAGE = [
  'Usage: micelio doctor',
  '       micelio export <site slug> [--personal] [--output <file>]',
].join('\n')

/**
 * Loads the project with the host check reporting instead of refusing, runs `work` on it and
 * destroys it. Answers 1 when the plugin is not enabled.
 */
async function withStrapi(work) {
  const { compileStrapi, createStrapi } = require('@strapi/strapi')
  const app = createStrapi(await compileStrapi())
  // The command's output is the result; Strapi's own boot lines would bury it.
  app.log.level = 'error'
  await app.register()
  if (!app.plugin('micelio')) {
    await app.destroy()
    process.stderr.write('micelio: the plugin is not enabled in this Strapi project.\n')
    return 1
  }
  // The boot runs the check; a command reports on it instead of refusing to start.
  app.plugin('micelio').service('hostCheck').reportOnly()
  await app.bootstrap()
  try {
    return await work(app)
  } finally {
    await app.destroy()
  }
}

function doctor() {
  const { formatHostCheckReport } = require('../dist/server/index.js')
  return withStrapi(async (app) => {
    const report = app.plugin('micelio').service('hostCheck').latest()
    process.stdout.write(`${formatHostCheckReport(report)}\n`)
    return report.ok ? 0 : 1
  })
}

async function exportCommand(args) {
  const options = parseExportArgs(args)
  if (!options) {
    process.stderr.write(`${USAGE}\n`)
    return 2
  }
  const now = new Date()
  const output = path.resolve(options.output ?? defaultArchiveName(options.site, now))
  // Written aside and renamed at the end, so a failed export never leaves a file that looks whole.
  const partial = `${output}.partial`
  return withStrapi(async (app) => {
    try {
      const manifest = await app
        .plugin('micelio')
        .service('siteExport')
        .export(
          { site: options.site, personal: options.personal, now },
          fs.createWriteStream(partial)
        )
      fs.renameSync(partial, output)
      const documents = manifest.types.reduce((sum, type) => sum + type.documents, 0)
      const personal = manifest.personal ? ', with personal data' : ''
      process.stdout.write(
        `${output}\n${documents} documents, ${manifest.media.count} media files${personal}.\n`
      )
      return 0
    } catch (error) {
      fs.rmSync(partial, { force: true })
      throw error
    }
  })
}

function parseExportArgs(args) {
  const options = { personal: false }
  for (let position = 0; position < args.length; position += 1) {
    const arg = args[position]
    if (arg === '--personal') options.personal = true
    else if (arg === '--output' && args[position + 1]) options.output = args[++position]
    else if (!arg.startsWith('--') && !options.site) options.site = arg
    else return undefined
  }
  return options.site ? options : undefined
}

/** `<site slug>-<UTC date and time>.micelio.tar.gz`, as docs/export-format.md names an archive. */
function defaultArchiveName(site, now) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
  return `${site}-${stamp}.micelio.tar.gz`
}

async function main(args) {
  const [command, ...rest] = args
  try {
    if (command === 'doctor') return await doctor()
    if (command === 'export') return await exportCommand(rest)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = error && typeof error === 'object' && 'code' in error ? ` (${error.code})` : ''
    process.stderr.write(`micelio ${command}: ${message}${code}\n`)
    return 1
  }
  process.stderr.write(`${USAGE}\n`)
  return 2
}

void (async () => {
  // Exits explicitly: Strapi leaves handles open (cron, the database pool) after destroy.
  process.exit(await main(process.argv.slice(2)))
})()
