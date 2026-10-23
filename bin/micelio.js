#!/usr/bin/env node
// `micelio doctor`: loads the Strapi project in the current folder as `strapi console` does,
// runs the host check of @micelio/strapi-plugin-core and prints every check. It exits with 1 when
// a required check fails, so a deploy script can stop on it. docs/operate/host-check.md has more.

const USAGE = 'Usage: micelio doctor'

async function doctor() {
  const { compileStrapi, createStrapi } = require('@strapi/strapi')
  const { formatHostCheckReport } = require('../dist/server/index.js')

  const app = createStrapi(await compileStrapi())
  // The report is the output; Strapi's own boot lines would bury it.
  app.log.level = 'error'
  await app.register()
  if (!app.plugin('micelio')) {
    await app.destroy()
    process.stderr.write('micelio: the plugin is not enabled in this Strapi project.\n')
    return 1
  }
  const hostCheck = app.plugin('micelio').service('hostCheck')
  // The boot runs the check; the doctor reports on it instead of refusing to start.
  hostCheck.reportOnly()
  await app.bootstrap()
  const report = hostCheck.latest()
  await app.destroy()
  process.stdout.write(`${formatHostCheckReport(report)}\n`)
  return report.ok ? 0 : 1
}

async function main(args) {
  if (args[0] !== 'doctor') {
    process.stderr.write(`${USAGE}\n`)
    return 2
  }
  try {
    return await doctor()
  } catch (error) {
    process.stderr.write(`micelio doctor: ${error instanceof Error ? error.message : error}\n`)
    return 1
  }
}

void (async () => {
  // Exits explicitly: Strapi leaves handles open (cron, the database pool) after destroy.
  process.exit(await main(process.argv.slice(2)))
})()
